// Mina kvitton – gränssnittet. All text från kvittona sätts in som text
// (textContent), aldrig som HTML.
"use strict";

(function () {
  var B = Bondeekonomi;
  var MÅNADER = ["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti",
    "september", "oktober", "november", "december"];

  var läge = {
    källa: null,
    kvitton: [],          // [{ json, filer }]
    år: new Date().getFullYear(),
    månad: 0,             // 0 = hela året
    sök: "",
    flik: "kvitton",
  };

  function $(id) { return document.getElementById(id); }

  /** el("p", { class: "x" }, "text", barn …) – text blir alltid ren text. */
  function el(tagg, attribut) {
    var nod = document.createElement(tagg);
    Object.keys(attribut || {}).forEach(function (k) {
      if (k === "text") nod.textContent = attribut[k];
      else if (k.indexOf("on") === 0) nod.addEventListener(k.slice(2), attribut[k]);
      else nod.setAttribute(k, attribut[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var barn = arguments[i];
      if (barn == null || barn === false) continue;
      nod.appendChild(typeof barn === "string" ? document.createTextNode(barn) : barn);
    }
    return nod;
  }

  function visa(vy) {
    ["inloggning", "laddar", "innehåll"].forEach(function (id) { $(id).hidden = id !== vy; });
  }

  function visaFel(text) {
    $("fel").textContent = text;
    $("fel").hidden = !text;
  }

  function datumtext(text) {
    var d = text.split("-").map(Number);
    if (d.length !== 3 || !d[0]) return text;
    return d[2] + " " + MÅNADER[d[1] - 1].slice(0, 3) + " " + d[0];
  }

  // MARK: Start

  function konfigureradKlient() {
    var k = window.BONDEEKONOMI_KONFIG;
    return k && k.googleKlientID ? k.googleKlientID : null;
  }

  async function starta(källa) {
    läge.källa = källa;
    visaFel("");
    visa("laddar");
    $("laddartext").textContent = "Hämtar dina kvitton från Google Drive …";
    try {
      var namn = await källa.konto();
      var kvitton = await källa.läsAlla(function (klara, av) {
        $("laddartext").textContent = "Hämtar kvitton … " + klara + " av " + av;
      });
      $("kontonamn").textContent = namn;
      $("konto").hidden = false;
      if (kvitton === null) {
        läge.kvitton = [];
        visa("innehåll");
        visaFel("Ingen säkerhetskopia från Bondeekonomi hittades i den här Google Drive. Slå på säkerhetskopian i appen under Mer › Säkerhetskopia, med samma Google-konto.");
      } else {
        läge.kvitton = kvitton;
        visa("innehåll");
      }
      var varning = B.ofullständigText(källa.ofullständigt);
      $("ofullständigt").textContent = varning || "";
      $("ofullständigt").hidden = !varning;
      fyllPeriodval();
      rita();
    } catch (fel) {
      läge.källa = null;
      $("konto").hidden = true;
      visa("inloggning");
      visaFel(fel.message || "Något gick fel. Försök igen.");
    }
  }

  async function loggaIn() {
    var klient = konfigureradKlient();
    if (!klient) {
      visaFel("Inloggningen är inte inställd på den här sidan än. Prova med exempelkvitton så länge.");
      return;
    }
    visaFel("");
    try {
      var token = await BondeekonomiDrive.loggaIn(klient);
      await starta(new BondeekonomiDrive.DriveKalla(token));
    } catch (fel) {
      visaFel(fel.message);
    }
  }

  function loggaUt() {
    läge.källa = null;
    läge.kvitton = [];
    $("konto").hidden = true;
    $("demoband").hidden = true;
    $("ofullständigt").hidden = true;
    if (location.search) history.replaceState(null, "", location.pathname);
    visa("inloggning");
  }

  // MARK: Val

  function fyllPeriodval() {
    var årval = $("år");
    årval.textContent = "";
    var åren = B.år(läge.kvitton.map(function (k) { return k.json; }), new Date().getFullYear());
    if (åren.indexOf(läge.år) === -1) läge.år = åren[0];
    åren.forEach(function (å) { årval.appendChild(el("option", { value: å, text: String(å) })); });
    årval.value = läge.år;

    var månadsval = $("månad");
    månadsval.textContent = "";
    månadsval.appendChild(el("option", { value: 0, text: "Hela året" }));
    MÅNADER.forEach(function (m, i) {
      månadsval.appendChild(el("option", { value: i + 1, text: m.charAt(0).toUpperCase() + m.slice(1) }));
    });
    månadsval.value = läge.månad;
  }

  function väljFlik(flik) {
    läge.flik = flik;
    $("flikKvitton").setAttribute("aria-selected", flik === "kvitton");
    $("flikSummering").setAttribute("aria-selected", flik === "summering");
    $("sök").hidden = flik !== "kvitton";
    rita();
  }

  // MARK: Rita

  function rita() {
    $("kvittolista").hidden = läge.flik !== "kvitton";
    $("summering").hidden = läge.flik !== "summering";
    if (läge.flik === "kvitton") ritaLista(); else ritaSummering();
  }

  function iVald(json) {
    return B.iPeriod(B.datum(json), läge.år, läge.månad || null);
  }

  function ritaLista() {
    var behållare = $("kvittolista");
    behållare.textContent = "";
    var poster = {};
    läge.kvitton.forEach(function (k) { poster[k.json.id] = k; });
    var synliga = B.sorterade(läge.kvitton.map(function (k) { return k.json; }))
      .filter(iVald)
      .filter(function (json) { return B.matchar(json, läge.sök); });

    if (synliga.length === 0) {
      behållare.appendChild(el("p", { class: "tomt", text: läge.sök
        ? "Inga kvitton matchar sökningen."
        : "Inga kvitton i den här perioden." }));
      return;
    }
    var lista = el("div", { class: "lista" });
    synliga.forEach(function (json) {
      var d = json.details || {};
      var titel = d.counterparty || d.description || "Kvitto";
      var kategorier = (d.lines || []).filter(function (r) { return r.business; })
        .map(function (r) { return B.kategorinamn(r.category); })
        .filter(function (namn, i, alla) { return alla.indexOf(namn) === i; });
      var ver = B.verifikation(json);
      var ejKlar = json.status === "toReview";
      var summa = B.summa(json);
      var inkomst = d.direction === "income";
      lista.appendChild(el("button", { type: "button", class: "kvitto", onclick: function () { visaDetalj(poster[json.id]); } },
        el("span", { class: "datum" }, ver ? el("span", { class: "ver", text: "Ver " + ver }) : null, datumtext(B.datum(json))),
        el("span", null,
          el("span", { class: "titel" }, ejKlar && !d.counterparty ? "Nytt kvitto" : titel,
            ejKlar ? el("span", { class: "märke orange", text: "Att gå igenom" }) : null),
          el("span", { class: "under", text: kategorier.join(" · ") || (ejKlar ? "Uppgifter fylls i i appen" : "") })),
        el("span", { class: "belopp" + (inkomst ? " inkomst" : ""), text: d.lines && d.lines.length ? (inkomst ? "+" : "") + B.beloppMedValuta(summa) : "" })));
    });
    behållare.appendChild(lista);
  }

  function ritaSummering() {
    var behållare = $("summering");
    behållare.textContent = "";
    var jsonLista = läge.kvitton.map(function (k) { return k.json; });
    var s = B.summering(jsonLista, läge.år, läge.månad || null);
    var ejGenomgångna = jsonLista.filter(function (j) { return j.status === "toReview" && iVald(j); }).length;

    function satsrader(satser) {
      return el.apply(null, ["ul", null].concat(satser.map(function (p) {
        return el("li", { text: p.sats + " %: moms " + B.beloppMedValuta(p.momsMinor) + " på " + B.beloppMedValuta(p.underlagMinor) + " exkl. moms" });
      })));
    }

    behållare.appendChild(el("div", { class: "kort-rad" },
      el("div", { class: "kort" },
        el("h3", { text: "Utgående moms" }),
        el("div", { class: "stort", text: B.beloppMedValuta(s.moms.utgåendeMinor) }),
        el("p", { class: "förklaring", text: "på försäljning och inkomster" }),
        satsrader(s.moms.utgående)),
      el("div", { class: "kort" },
        el("h3", { text: "Ingående moms" }),
        el("div", { class: "stort", text: B.beloppMedValuta(s.moms.ingåendeMinor) }),
        el("p", { class: "förklaring", text: "på inköp och utgifter" }),
        satsrader(s.moms.ingående),
        s.moms.ingåendeOsäkerMinor ? el("p", { class: "varning", text: "Varav " + B.beloppMedValuta(s.moms.ingåendeOsäkerMinor) + " på rader du är osäker på – fråga revisorn." }) : null),
      el("div", { class: "kort" },
        el("h3", { text: "Skillnad mellan registrerad moms" }),
        el("div", { class: "stort", text: B.beloppMedValuta(s.moms.skillnadMinor) }),
        el("p", { class: "förklaring", text: "utgående minus ingående moms" }))));

    if (!$("ofullständigt").hidden) {
      behållare.appendChild(el("p", { class: "varning", text: "Summeringen är ofullständig: " + $("ofullständigt").textContent }));
    }
    if (ejGenomgångna) {
      behållare.appendChild(el("p", { class: "varning", text: (ejGenomgångna === 1 ? "1 kvitto" : ejGenomgångna + " kvitton") + " i Att gå igenom räknas inte med." }));
    }

    function tabell(rubrik, sida) {
      var kropp = el("tbody");
      sida.perKategori.forEach(function (p) {
        kropp.appendChild(el("tr", null,
          el("td", { text: p.namn }),
          el("td", { class: "tal", text: B.beloppMedValuta(p.beloppMinor) }),
          el("td", { class: "tal", text: B.beloppMedValuta(p.momsMinor) })));
      });
      if (!sida.perKategori.length) kropp.appendChild(el("tr", null, el("td", { colspan: 3, text: "Inga" })));
      return el("div", { class: "kort" },
        el("h3", { text: rubrik }),
        el("table", { class: "summor" },
          el("thead", null, el("tr", null, el("th", { text: "Kategori" }), el("th", { class: "tal", text: "Inkl. moms" }), el("th", { class: "tal", text: "Moms" }))),
          kropp,
          el("tfoot", null, el("tr", null, el("td", { text: "Totalt" }),
            el("td", { class: "tal", text: B.beloppMedValuta(sida.beloppMinor) }),
            el("td", { class: "tal", text: B.beloppMedValuta(sida.momsMinor) })))));
    }
    behållare.appendChild(el("div", { class: "kort-rad" }, tabell("Inkomster", s.inkomster), tabell("Utgifter", s.utgifter)));
    behållare.appendChild(el("p", { class: "fotnot", text: s.antalUnderlag + " genomgångna kvitton. Bara verksamhetens del räknas. Ett underlag till redovisningshjälpen – inte en momsdeklaration och inget besked om vad du ska betala." }));
  }

  // MARK: Detalj

  function visaDetalj(post) {
    var json = post.json;
    var d = json.details || {};
    var innehåll = $("detaljinnehåll");
    innehåll.textContent = "";
    var ver = B.verifikation(json);
    if (ver) innehåll.appendChild(el("p", { class: "detalj-ver", text: "Ver " + ver }));
    innehåll.appendChild(el("h2", { id: "detaljrubrik", text: d.counterparty || d.description || "Kvitto" }));

    var lista = el("dl", { class: "uppgifter" });
    function rad(etikett, värde) { if (värde) lista.append(el("dt", { text: etikett }), el("dd", { text: värde })); }
    rad("Status", json.status === "done" ? "Genomgånget" : "Att gå igenom – fylls i i appen");
    rad("Datum", datumtext(B.datum(json)));
    rad("Typ", d.lines && d.lines.length ? (d.direction === "income" ? "Inkomst" : "Utgift") : "");
    rad("Avser", d.description);
    if (d.totalMinor != null) rad("Kvittots totalbelopp", B.beloppMedValuta(d.totalMinor));
    rad("Anteckning", d.note);
    innehåll.appendChild(lista);

    if (d.lines && d.lines.length) {
      var rader = el("ul", { class: "rader" });
      d.lines.forEach(function (r) {
        var märken = [];
        if (!r.business) märken.push(el("span", { class: "märke grå", text: "Privat – räknas inte" }));
        if (r.uncertain) märken.push(el("span", { class: "märke orange", text: "Fråga revisorn" }));
        rader.appendChild(el.apply(null, ["li", { class: r.business ? "" : "privat" },
          el("span", { class: "radtitel", text: r.text || B.kategorinamn(r.category) }),
          el("span", { class: "radbelopp", text: B.beloppMedValuta(r.amountMinor) }),
          el("span", { class: "radinfo", text: (r.text ? B.kategorinamn(r.category) + " · " : "") + "moms " + r.vatRate + " %: " + B.beloppMedValuta(r.vatMinor) })
        ].concat(märken)));
      });
      innehåll.appendChild(rader);
      innehåll.appendChild(el("p", { class: "verksamhet" }, "Verksamhetens del: ",
        el("strong", { text: B.beloppMedValuta(B.summa(json)) })));
    }

    var bilder = el("div", { class: "bilder" });
    (json.attachments || []).slice().sort(function (a, b) { return a.order - b.order; }).forEach(function (bilaga) {
      var plats = el("div", { class: "bildplats", text: "Laddar bild …" });
      bilder.appendChild(plats);
      var filID = post.filer[bilaga.fileName];
      if (!filID) { plats.textContent = "Bilden finns inte i Google Drive."; return; }
      läge.källa.fil(filID).then(function (adress) {
        var ärPdf = bilaga.contentType === "application/pdf";
        var länk = el("a", { href: adress, target: "_blank", rel: "noopener" },
          ärPdf ? el("span", { class: "bildplats", text: "Öppna PDF (bild " + bilaga.order + ")" })
                : el("img", { src: adress, alt: "Kvittobild " + bilaga.order, loading: "lazy" }));
        plats.replaceWith(länk);
      }).catch(function () { plats.textContent = "Bilden kunde inte laddas."; });
    });
    innehåll.appendChild(bilder);
    innehåll.appendChild(el("p", { class: "liten", text: "Underlags-ID " + json.id }));
    $("detalj").showModal();
  }

  // MARK: Kopplingar

  document.addEventListener("DOMContentLoaded", function () {
    $("loggaIn").addEventListener("click", loggaIn);
    $("loggaUt").addEventListener("click", loggaUt);
    $("flikKvitton").addEventListener("click", function () { väljFlik("kvitton"); });
    $("flikSummering").addEventListener("click", function () { väljFlik("summering"); });
    $("år").addEventListener("change", function (e) { läge.år = Number(e.target.value); rita(); });
    $("månad").addEventListener("change", function (e) { läge.månad = Number(e.target.value); rita(); });
    $("sök").addEventListener("input", function (e) { läge.sök = e.target.value; rita(); });
    $("stängDetalj").addEventListener("click", function () { $("detalj").close(); });
    $("detalj").addEventListener("click", function (e) { if (e.target === $("detalj")) $("detalj").close(); });

    if (new URLSearchParams(location.search).has("demo")) {
      $("demoband").hidden = false;
      starta(new BondeekonomiDemo.DemoKalla());
    }
  });
})();
