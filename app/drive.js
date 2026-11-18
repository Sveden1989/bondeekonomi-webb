// Läser kvittona direkt från användarens Google Drive – ingen egen server.
// Samma mappar och filer som appen skapar (se docs/dataformat.md):
//   Bondeekonomi/ (appProperties bondeekonomi=rot) › Underlag/ › <UUID>/ › underlag.json + bilder
// Behörigheten drive.file: sidan ser bara filer som Bondeekonomi själv har skapat.
// Webben ändrar aldrig något.
"use strict";

var BondeekonomiDrive = (function () {
  var API = "https://www.googleapis.com/drive/v3";
  var MAPP = "application/vnd.google-apps.folder";
  var BEHÖRIGHET = "https://www.googleapis.com/auth/drive.file";
  /** Så många underlag.json läses samtidigt. */
  var SAMTIDIGA = 8;

  function Utloggad() { this.name = "Utloggad"; this.message = "Inloggningen har gått ut. Logga in igen."; }
  Utloggad.prototype = Object.create(Error.prototype);

  /** En källa som läser från Google Drive med en åtkomsttoken. */
  function DriveKalla(token) {
    this.token = token;
    this.bildcache = {};
  }

  /** Väntetid före försök nummer `försök` (1, 2, 3 …): 0,5, 1, 2 s … plus slump. */
  function väntetid(försök) {
    return 500 * Math.pow(2, försök - 1) + Math.random() * 250;
  }

  /** Fel som brukar gå över: för många anrop (429/403) eller fel hos Google (5xx). */
  function tillfälligt(status) {
    return status === 429 || status === 403 || status >= 500;
  }

  DriveKalla.prototype.vänta = function (ms) {
    return new Promise(function (klar) { setTimeout(klar, ms); });
  };

  /** Antal nya försök efter ett tillfälligt fel innan det ges upp. */
  DriveKalla.prototype.försök = 4;

  DriveKalla.prototype.hämta = async function (url) {
    for (var försök = 0; ; försök += 1) {
      if (försök > 0) await this.vänta(väntetid(försök));
      var svar;
      try {
        svar = await fetch(url, { headers: { Authorization: "Bearer " + this.token } });
      } catch (e) {
        if (försök < this.försök) continue;
        throw new Error("Ingen kontakt med Google Drive. Kontrollera internet och försök igen.");
      }
      if (svar.status === 401) throw new Utloggad();
      if (svar.ok) return svar;
      if (tillfälligt(svar.status) && försök < this.försök) continue;
      throw new Error("Google Drive svarade med fel " + svar.status + ".");
    }
  };

  DriveKalla.prototype.sök = async function (fråga, fält, ordning) {
    var träffar = [];
    var nästa = null;
    do {
      var p = new URLSearchParams({
        q: fråga, spaces: "drive", pageSize: "1000",
        fields: "nextPageToken,files(" + (fält || "id,name") + ")",
        orderBy: ordning || "createdTime",
      });
      if (nästa) p.set("pageToken", nästa);
      var sida = await (await this.hämta(API + "/files?" + p.toString())).json();
      träffar = träffar.concat(sida.files || []);
      nästa = sida.nextPageToken;
    } while (nästa);
    return träffar;
  };

  /** Kontots namn/e-post, för att visa vem som är inloggad. */
  DriveKalla.prototype.konto = async function () {
    try {
      var om = await (await this.hämta(API + "/about?fields=user(displayName,emailAddress)")).json();
      return (om.user && (om.user.emailAddress || om.user.displayName)) || "";
    } catch (e) {
      if (e instanceof Utloggad) throw e;
      return "";
    }
  };

  /** Egna kategorinamn. Går filen inte att läsa visas standardnamnen. */
  DriveKalla.prototype.läsKategorier = async function (rot) {
    Bondeekonomi.sättKategorier(null);
    var filer = await this.sök("'" + rot + "' in parents and name = 'kategorier.json' and trashed = false", null, "modifiedTime desc");
    if (filer.length === 0) return;
    try {
      Bondeekonomi.sättKategorier(JSON.parse(await (await this.hämta(API + "/files/" + filer[0].id + "?alt=media")).text()));
    } catch (fel) {
      if (fel instanceof Utloggad) throw fel;
    }
  };

  /**
   * Alla kvitton: [{ json, filer: { filnamn: filID } }]. `framsteg(antal, av)`
   * anropas medan underlag.json-filerna laddas ner. Saknas säkerhetskopian
   * returneras null.
   */
  DriveKalla.prototype.läsAlla = async function (framsteg) {
    var rötter = await this.sök(
      "appProperties has { key = 'bondeekonomi' and value = 'rot' } and mimeType = '" + MAPP + "' and trashed = false"
    );
    if (rötter.length === 0) return null;
    await this.läsKategorier(rötter[0].id);
    var underlag = await this.sök(
      "'" + rötter[0].id + "' in parents and name = 'Underlag' and mimeType = '" + MAPP + "' and trashed = false"
    );
    if (underlag.length === 0) return [];
    var mappar = await this.sök("'" + underlag[0].id + "' in parents and mimeType = '" + MAPP + "' and trashed = false");
    if (mappar.length === 0) return [];
    var namnFörMapp = {};
    mappar.forEach(function (m) { namnFörMapp[m.id] = m.name; });

    // Alla filer appen har skapat – en sökning oavsett antal kvitton. Nyast först,
    // så att den senaste underlag.json väljs om det finns dubbletter.
    var filer = await this.sök("mimeType != '" + MAPP + "' and trashed = false", "id,name,parents,modifiedTime", "modifiedTime desc");
    var perMapp = {};
    filer.forEach(function (fil) {
      (fil.parents || []).forEach(function (förälder) {
        var namn = namnFörMapp[förälder];
        if (!namn) return;
        var mapp = perMapp[namn] || (perMapp[namn] = {});
        if (!mapp[fil.name]) mapp[fil.name] = fil.id; // den nyaste vinner
      });
    });

    var namnen = Object.keys(perMapp).filter(function (n) { return perMapp[n]["underlag.json"]; });
    // Mappar utan underlag.json (tomma eller med bara bilder) är kvitton som
    // telefonen inte har laddat upp färdigt – de räknas, men skiljs från fel.
    var uppladdas = mappar.filter(function (m) { return !(perMapp[m.name] && perMapp[m.name]["underlag.json"]); }).length;
    var olästa = 0;
    var ejHämtade = 0;
    var kvitton = [];
    var klara = 0;
    var nästaIndex = 0;
    var källa = this;
    // Varje fil läses för sig. Ett fel på en fil (efter nya försök) gör bara
    // att just det kvittot saknas – resten visas ändå. Utloggning avbryter allt.
    async function läsNästa() {
      while (nästaIndex < namnen.length) {
        var namn = namnen[nästaIndex++];
        try {
          var text = await (await källa.hämta(API + "/files/" + perMapp[namn]["underlag.json"] + "?alt=media")).text();
          var json = Bondeekonomi.tolka(text, namn);
          if (json) kvitton.push({ json: json, filer: perMapp[namn] });
          else olästa += 1;
        } catch (fel) {
          if (fel instanceof Utloggad) throw fel;
          ejHämtade += 1;
        }
        klara += 1;
        if (framsteg) framsteg(klara, namnen.length);
      }
    }
    // Några åt gången, så att Drive inte begränsar oss.
    var arbetare = [];
    for (var i = 0; i < Math.min(SAMTIDIGA, namnen.length); i += 1) arbetare.push(läsNästa());
    await Promise.all(arbetare);
    // Läses av sidan efter läsAlla. Webben ändrar aldrig något i Drive.
    this.ofullständigt = { olästa: olästa, uppladdas: uppladdas, ejHämtade: ejHämtade };
    return kvitton;
  };

  /** Filtyper som får visas. Allt annat öppnas som en vanlig nedladdning. */
  var TILLÅTNA_TYPER = ["image/jpeg", "image/png", "application/pdf"];

  function säkerTyp(typ) {
    return TILLÅTNA_TYPER.indexOf(typ) >= 0 ? typ : "application/octet-stream";
  }

  /**
   * En bild eller PDF som blob-adress (laddas ner först när den visas).
   * Filtypen tas från kvittots egna uppgifter och begränsas till JPEG, PNG och
   * PDF – aldrig den typ Drive råkar uppge.
   */
  DriveKalla.prototype.fil = async function (filID, typ) {
    if (this.bildcache[filID]) return this.bildcache[filID];
    var data = await (await this.hämta(API + "/files/" + filID + "?alt=media")).blob();
    var adress = URL.createObjectURL(new Blob([data], { type: säkerTyp(typ) }));
    this.bildcache[filID] = adress;
    return adress;
  };

  /** Släpper bilderna ur minnet, t.ex. vid utloggning. */
  DriveKalla.prototype.glöm = function () {
    Object.keys(this.bildcache).forEach(function (id) { URL.revokeObjectURL(this.bildcache[id]); }, this);
    this.bildcache = {};
    this.token = null;
  };

  // MARK: Inloggning (Google Identity Services)

  var GOOGLE_SKRIPT = "https://accounts.google.com/gsi/client";
  var googleLaddas = null;

  /**
   * Laddar Googles inloggningsskript först när det behövs – inte för alla som
   * bara tittar på sidan. Anropas när man pekar på eller trycker Logga in.
   */
  function laddaGoogle() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (googleLaddas) return googleLaddas;
    googleLaddas = new Promise(function (lös, avvisa) {
      var skript = document.createElement("script");
      skript.src = GOOGLE_SKRIPT;
      skript.async = true;
      skript.onload = function () { lös(); };
      skript.onerror = function () {
        googleLaddas = null;
        skript.remove();
        avvisa(new Error("Googles inloggning kunde inte laddas. Kontrollera internet eller tillägg som blockerar."));
      };
      document.head.appendChild(skript);
    });
    return googleLaddas;
  }

  /**
   * Ber Google om en åtkomsttoken i ett eget fönster. Löser ut med token-texten.
   * Inget sparas i webbläsaren; laddas sidan om får man logga in igen.
   */
  async function loggaIn(klientID) {
    await laddaGoogle();
    return new Promise(function (lös, avvisa) {
      if (!window.google || !google.accounts || !google.accounts.oauth2) {
        avvisa(new Error("Googles inloggning kunde inte laddas. Kontrollera internet eller tillägg som blockerar."));
        return;
      }
      var klient = google.accounts.oauth2.initTokenClient({
        client_id: klientID,
        scope: BEHÖRIGHET,
        callback: function (svar) {
          if (svar.error) { avvisa(new Error("Inloggningen avbröts.")); return; }
          if (!google.accounts.oauth2.hasGrantedAllScopes(svar, BEHÖRIGHET)) {
            avvisa(new Error("Sidan behöver få läsa Bondeekonomis filer i din Google Drive. Logga in igen och godkänn det."));
            return;
          }
          lös(svar.access_token);
        },
        error_callback: function () { avvisa(new Error("Inloggningsfönstret stängdes.")); },
      });
      klient.requestAccessToken();
    });
  }

  // Utloggning återkallar inte Googles godkännande: det kan gälla hela
  // Bondeekonomi och stoppa appens säkerhetskopia. Sidan glömmer bara sin
  // token, som ändå slutar gälla inom en timme.

  return { DriveKalla: DriveKalla, Utloggad: Utloggad, loggaIn: loggaIn, laddaGoogle: laddaGoogle, säkerTyp: säkerTyp };
})();
