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

  /** Okänd kategori räknas som osäker, precis som i appen. */
  function kategori(kod) {
    return Object.prototype.hasOwnProperty.call(kategoriNamn, kod) ? kod : "osaker";
  }

  function kategorinamn(kod) {
    return kategoriNamn[kategori(kod)];
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

  /** Söker i motpart, beskrivning, anteckning, rader, verifikation och ID. */
  function matchar(json, sökning) {
    var text = (sökning || "").trim().toLowerCase();
    if (!text) return true;
    var d = json.details || {};
    var delar = [d.counterparty, d.description, d.note, verifikation(json), json.id]
      .concat((d.lines || []).map(function (r) { return r.text; }));
    return delar.join(" ").toLowerCase().indexOf(text) !== -1;
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
        .sort(function (a, b) { return kategoriOrdning[a.kategori] - kategoriOrdning[b.kategori]; });
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
    KATEGORIER: KATEGORIER,
    kategori: kategori,
    kategorinamn: kategorinamn,
    belopp: belopp,
    beloppMedValuta: beloppMedValuta,
    verifikation: verifikation,
    datum: datum,
    iPeriod: iPeriod,
    summa: summa,
    sorterade: sorterade,
    matchar: matchar,
    summering: summering,
    år: år,
    tolka: tolka,
  };
})();
