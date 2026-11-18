// Bondeekonomi på webben – ren logik utan sidan eller nätet.
// Samma regler som appen (Summering.swift, Kategori.swift, UnderlagJSON.swift),
// så att webben visar exakt samma siffror. Testas från appens testsvit
// via JavaScriptCore (WebblogikTests.swift).
"use strict";

var Bondeekonomi = (function () {
  // Ordningen är densamma som i appen. Nycklarna sparas i underlag.json.
  var KATEGORIER = [
    ["foder", "Foder och strö"],
    ["vaxtodling", "Utsäde, gödsel och växtskydd"],
    ["drivmedel", "Drivmedel och energi"],
    ["maskiner", "Maskiner, redskap och reparationer"],
    ["byggnader", "Byggnader, stängsel och mark"],
    ["tjanster", "Tjänster och entreprenad"],
    ["fordon", "Bil och transporter"],
    ["administration", "Försäkring, avgifter och kontor"],
    ["ovrig_kostnad", "Övriga kostnader"],
    ["forsaljning", "Försäljning"],
    ["stod", "Stöd och ersättningar"],
    ["ovrig_intakt", "Övriga intäkter"],
    ["osaker", "Osäker kategori – fråga revisorn"],
  ];
  var kategoriOrdning = {};
  var kategoriNamn = {};
  KATEGORIER.forEach(function (k, i) {
    kategoriOrdning[k[0]] = i;
    kategoriNamn[k[0]] = k[1];
  });

  // Användarens namn från kategorier.json: nya namn och egna kategorier.
  var egnaNamn = Object.create(null);

  function ärInbyggd(kod) {
    return Object.prototype.hasOwnProperty.call(kategoriNamn, kod);
  }

  function ärEgenKod(kod) {
    return typeof kod === "string" && kod.length <= 64 && /^egen_[A-Za-z0-9_-]+$/.test(kod);
  }

  /** Läser kategorier.json. Utan fil (null) gäller standardnamnen. */
  function sättKategorier(inställningar) {
    egnaNamn = Object.create(null);
    var poster = inställningar && Array.isArray(inställningar.categories) ? inställningar.categories : [];
    poster.forEach(function (post) {
      if (!post || typeof post.name !== "string" || post.code === "osaker") return;
      if (!ärInbyggd(post.code) && !ärEgenKod(post.code)) return;
      var namn = post.name.trim().slice(0, 40);
      if (namn) egnaNamn[post.code] = namn;
    });
  }

  /** Okänd kategori räknas som osäker, precis som i appen. Egna koder behålls. */
  function kategori(kod) {
    return ärInbyggd(kod) || ärEgenKod(kod) ? kod : "osaker";
  }

  function kategorinamn(kod) {
    var k = kategori(kod);
    return egnaNamn[k] || (ärInbyggd(k) ? kategoriNamn[k] : "Egen kategori");
  }

  /** Inbyggda, egna efter namn, sist osäker – samma ordning som i appen. */
  function ordningstal(kod) {
    if (kod === "osaker") return 200;
    return ärInbyggd(kod) ? kategoriOrdning[kod] : 100;
  }

  function jämförKategorier(a, b) {
    return ordningstal(a.kategori) - ordningstal(b.kategori)
      || a.namn.localeCompare(b.namn, "sv")
      || (a.kategori < b.kategori ? -1 : 1);
  }

  /** 127680 → "1 276,80" (svenskt format, vanligt bindestreck för minus). */
  function belopp(öre) {
    var tecken = öre < 0 ? "-" : "";
    var absolut = Math.abs(öre);
    var kronor = Math.floor(absolut / 100).toString();
    var ören = (absolut % 100).toString();
    if (ören.length < 2) ören = "0" + ören;
    // Tusentalsavgränsare: hårt mellanslag, som appen.
    var delar = [];
    while (kronor.length > 3) {
      delar.unshift(kronor.slice(-3));
      kronor = kronor.slice(0, -3);
    }
    delar.unshift(kronor);
    return tecken + delar.join(" ") + "," + ören;
  }

  function beloppMedValuta(öre) {
    return belopp(öre) + " kr";
  }

  /** Verifikationsnummer som text, t.ex. "2026-0001", eller "" om det saknas. */
  function verifikation(json) {
    var v = json.voucher;
    if (!v) return "";
    var nummer = String(v.number);
    while (nummer.length < 4) nummer = "0" + nummer;
    return v.year + "-" + nummer;
  }

  /** "ÅÅÅÅ-MM-DD": affärsdatum, annars dagen kvittot sparades (UTC-dagen räcker för listan). */
  function datum(json) {
    if (json.details && json.details.date) return json.details.date;
    return String(json.createdAt || "").slice(0, 10);
  }

  /** Ligger datumet ("ÅÅÅÅ-MM-DD") i året och – om given – månaden? */
  function iPeriod(datumText, år, månad) {
    if (!datumText || Number(datumText.slice(0, 4)) !== år) return false;
    return !månad || Number(datumText.slice(5, 7)) === månad;
  }

  function verksamhetsrader(json) {
    var rader = (json.details && json.details.lines) || [];
    return rader.filter(function (r) { return r.business; });
  }

  /** Verksamhetens del inklusive moms, i öre. */
  function summa(json) {
    return verksamhetsrader(json).reduce(function (s, r) { return s + r.amountMinor; }, 0);
  }

  function ärOsäkerRad(rad) {
    return kategori(rad.category) === "osaker" || rad.uncertain === true;
  }

  /** Synliga kvitton (inte papperskorgen), nyast först. */
  function sorterade(kvitton) {
    return kvitton
      .filter(function (k) { return k.status !== "deleted"; })
      .slice()
      .sort(function (a, b) {
        var d = datum(b).localeCompare(datum(a));
        return d !== 0 ? d : String(b.createdAt).localeCompare(String(a.createdAt));
      });
  }

  /** Bort med mellanslag (även hårda) så att "1245" hittar "1 245,00". */
  function utanMellanslag(text) {
    return text.replace(/[\s\u00a0\u202f]/g, "");
  }

  /**
   * Söker i motpart, beskrivning, anteckning, rader, verifikation, ID och
   * belopp (verksamhetens del och varje rad, t.ex. "1245" eller "1 245,00").
   */
  function matchar(json, sökning) {
    var text = (sökning || "").trim().toLowerCase();
    if (!text) return true;
    var d = json.details || {};
    var delar = [d.counterparty, d.description, d.note, verifikation(json), json.id]
      .concat((d.lines || []).map(function (r) { return r.text; }));
    if (delar.join(" ").toLowerCase().indexOf(text) !== -1) return true;
    var sökt = utanMellanslag(text);
    if (!/^[0-9.,-]+$/.test(sökt)) return false;
    var beloppen = (d.lines && d.lines.length ? [summa(json)] : [])
      .concat((d.lines || []).map(function (r) { return r.amountMinor; }));
    return beloppen.some(function (öre) { return utanMellanslag(belopp(öre)).indexOf(sökt) !== -1; });
  }

  /**
   * Filter i listan: `visa` är "alla", "utgift", "inkomst" eller "attGåIgenom";
   * `kategori` en kategorikod (tom = alla). Kategorin matchar om någon av
   * verksamhetens rader har den.
   */
  function passarFilter(json, filter) {
    var f = filter || {};
    var d = json.details || {};
    if (f.visa === "attGåIgenom" && json.status !== "toReview") return false;
    if (f.visa === "utgift" && (json.status === "toReview" || d.direction === "income")) return false;
    if (f.visa === "inkomst" && (json.status === "toReview" || d.direction !== "income")) return false;
    if (f.kategori && !verksamhetsrader(json).some(function (r) { return kategori(r.category) === f.kategori; })) return false;
    return true;
  }

  /** Kategorierna som finns på kvittona, i appens ordning: [{ kategori, namn }]. */
  function användaKategorier(kvitton) {
    var sett = {};
    kvitton.forEach(function (json) {
      if (json.status === "deleted") return;
      verksamhetsrader(json).forEach(function (r) { sett[kategori(r.category)] = true; });
    });
    return Object.keys(sett).map(function (k) { return { kategori: k, namn: kategorinamn(k) }; }).sort(jämförKategorier);
  }

  /** Störst belopp först; lika belopp i datumordning (nyast först). */
  function sorteradePåBelopp(kvitton) {
    var datumordning = sorterade(kvitton);
    var plats = {};
    datumordning.forEach(function (k, i) { plats[k.id] = i; });
    return datumordning.slice().sort(function (a, b) { return summa(b) - summa(a) || plats[a.id] - plats[b.id]; });
  }

  /**
   * Samma uträkning som Summering.swift: bara genomgångna kvitton med datum i
   * perioden, bara verksamhetens rader; per kategori och per momssats.
   */
  function summering(kvitton, år, månad) {
    var resultat = {
      antalUnderlag: 0, antalOsäkraRader: 0, antalFrågaRevisorn: 0,
      inkomster: { beloppMinor: 0, momsMinor: 0, perKategori: [] },
      utgifter: { beloppMinor: 0, momsMinor: 0, perKategori: [] },
      moms: { utgående: [], ingående: [], utgåendeMinor: 0, ingåendeMinor: 0, ingåendeOsäkerMinor: 0, skillnadMinor: 0 },
    };
    var inkomst = {}, utgift = {}, utgåendeMoms = {}, ingåendeMoms = {};

    kvitton.forEach(function (json) {
      if (json.status !== "done" || !json.details || !json.details.date) return;
      if (!iPeriod(json.details.date, år, månad)) return;
      var rader = verksamhetsrader(json);
      if (rader.length === 0) return;
      resultat.antalUnderlag += 1;
      var ärInkomst = json.details.direction === "income";
      rader.forEach(function (rad) {
        var kod = kategori(rad.category);
        if (kod === "osaker") resultat.antalOsäkraRader += 1;
        if (rad.uncertain === true) resultat.antalFrågaRevisorn += 1;
        var sida = ärInkomst ? inkomst : utgift;
        var post = sida[kod] || (sida[kod] = { kategori: kod, namn: kategorinamn(kod), beloppMinor: 0, momsMinor: 0, antal: 0 });
        post.beloppMinor += rad.amountMinor;
        post.momsMinor += rad.vatMinor;
        post.antal += 1;
        var momsSida = ärInkomst ? utgåendeMoms : ingåendeMoms;
        var sats = momsSida[rad.vatRate] || (momsSida[rad.vatRate] = { sats: rad.vatRate, underlagMinor: 0, momsMinor: 0 });
        sats.underlagMinor += rad.amountMinor - rad.vatMinor;
        sats.momsMinor += rad.vatMinor;
        if (!ärInkomst && ärOsäkerRad(rad)) resultat.moms.ingåendeOsäkerMinor += rad.vatMinor;
      });
    });

    function sida(poster) {
      var lista = Object.keys(poster).map(function (k) { return poster[k]; })
        .sort(jämförKategorier);
      return {
        beloppMinor: lista.reduce(function (s, p) { return s + p.beloppMinor; }, 0),
        momsMinor: lista.reduce(function (s, p) { return s + p.momsMinor; }, 0),
        perKategori: lista,
      };
    }
    function satser(poster) {
      return Object.keys(poster).map(function (k) { return poster[k]; })
        .sort(function (a, b) { return b.sats - a.sats; });
    }

    resultat.inkomster = sida(inkomst);
    resultat.utgifter = sida(utgift);
    resultat.moms.utgående = satser(utgåendeMoms);
    resultat.moms.ingående = satser(ingåendeMoms);
    resultat.moms.utgåendeMinor = resultat.moms.utgående.reduce(function (s, p) { return s + p.momsMinor; }, 0);
    resultat.moms.ingåendeMinor = resultat.moms.ingående.reduce(function (s, p) { return s + p.momsMinor; }, 0);
    resultat.moms.skillnadMinor = resultat.moms.utgåendeMinor - resultat.moms.ingåendeMinor;
    return resultat;
  }

  /** Åren som finns bland kvittona plus innevarande år, nyast först. */
  function år(kvitton, iÅr) {
    var mängd = {};
    mängd[iÅr] = true;
    kvitton.forEach(function (k) {
      var å = Number(datum(k).slice(0, 4));
      if (å) mängd[å] = true;
    });
    return Object.keys(mängd).map(Number).sort(function (a, b) { return b - a; });
  }

  /**
   * Varning när inte alla kvitton i Drive kom med, så att en summa aldrig ser
   * komplett ut när den inte är det. null om allt lästes.
   */
  function ofullständigText(ofullständigt) {
    if (!ofullständigt) return null;
    var delar = [];
    var st = function (n) { return n === 1 ? "1 kvitto" : n + " kvitton"; };
    if (ofullständigt.olästa) delar.push(st(ofullständigt.olästa) + " kunde inte läsas – uppdatera appen på telefonen eller kontakta support");
    if (ofullständigt.ejHämtade) delar.push(st(ofullständigt.ejHämtade) + " kunde inte hämtas från Google Drive just nu – ladda om sidan om en stund");
    if (ofullständigt.uppladdas) delar.push(st(ofullständigt.uppladdas) + (ofullständigt.uppladdas === 1 ? " är inte färdiguppladdat" : " är inte färdiguppladdade") + " från telefonen än");
    if (!delar.length) return null;
    return delar.join(". ") + ". De räknas inte med i listan och summeringen.";
  }

  /**
   * Läser en underlag.json-text. Returnerar null om filen inte kan användas:
   * okänd version, okänd status eller ID som inte stämmer med mappnamnet.
   */
  function tolka(text, mappnamn) {
    var json;
    try { json = JSON.parse(text); } catch (e) { return null; }
    if (!json || typeof json !== "object" || json.schemaVersion > 1) return null;
    if (["toReview", "done", "deleted"].indexOf(json.status) === -1) return null;
    if (mappnamn && String(json.id).toUpperCase() !== String(mappnamn).toUpperCase()) return null;
    return json;
  }

  return {
    ofullständigText: ofullständigText,
    KATEGORIER: KATEGORIER,
    kategori: kategori,
    kategorinamn: kategorinamn,
    sättKategorier: sättKategorier,
    belopp: belopp,
    beloppMedValuta: beloppMedValuta,
    verifikation: verifikation,
    datum: datum,
    iPeriod: iPeriod,
    summa: summa,
    sorterade: sorterade,
    matchar: matchar,
    passarFilter: passarFilter,
    användaKategorier: användaKategorier,
    sorteradePåBelopp: sorteradePåBelopp,
    summering: summering,
    år: år,
    tolka: tolka,
  };
})();
