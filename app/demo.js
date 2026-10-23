// Påhittade kvitton för att visa webbversionen utan konto (?demo).
// Inga riktiga personer, företag eller belopp.
"use strict";

var BondeekonomiDemo = (function () {
  function kvittobild(butik, rader, total, moms) {
    var y = 150;
    var radtext = rader.map(function (r) {
      y += 34;
      return '<text x="30" y="' + y + '" font-size="20">' + r[0] + '</text>' +
        '<text x="330" y="' + y + '" font-size="20" text-anchor="end">' + r[1] + '</text>';
    }).join("");
    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="360" height="520" viewBox="0 0 360 520" font-family="Menlo, monospace" fill="#222">' +
      '<rect width="360" height="520" fill="#fbfaf6"/>' +
      '<text x="180" y="60" font-size="26" font-weight="bold" text-anchor="middle">' + butik + '</text>' +
      '<text x="180" y="92" font-size="16" text-anchor="middle" fill="#666">Org.nr 556000-0000</text>' +
      '<line x1="30" y1="120" x2="330" y2="120" stroke="#999" stroke-dasharray="6 4"/>' +
      radtext +
      '<line x1="30" y1="' + (y + 24) + '" x2="330" y2="' + (y + 24) + '" stroke="#999" stroke-dasharray="6 4"/>' +
      '<text x="30" y="' + (y + 60) + '" font-size="22" font-weight="bold">TOTALT</text>' +
      '<text x="330" y="' + (y + 60) + '" font-size="22" font-weight="bold" text-anchor="end">' + total + '</text>' +
      '<text x="30" y="' + (y + 92) + '" font-size="18" fill="#555">varav moms</text>' +
      '<text x="330" y="' + (y + 92) + '" font-size="18" fill="#555" text-anchor="end">' + moms + '</text>' +
      '</svg>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function kvitto(id, datum, motpart, riktning, rader, nummer, status, beskrivning) {
    return {
      schemaVersion: 1, id: id, createdAt: datum + "T09:00:00Z", updatedAt: datum + "T09:00:00Z",
      status: status || "done",
      attachments: [{ id: id + "-B", fileName: id + ".jpeg", contentType: "image/jpeg", order: 1, sha256: "", byteCount: 0, addedAt: datum + "T09:00:00Z" }],
      details: { date: datum, counterparty: motpart, description: beskrivning || "", direction: riktning, currency: "SEK", note: "", lines: rader },
      voucher: nummer ? { year: Number(datum.slice(0, 4)), number: nummer, assignedAt: datum + "T09:00:00Z" } : undefined,
    };
  }
  function rad(belopp, sats, moms, kategori, extra) {
    var r = { id: Math.random().toString(36).slice(2), amountMinor: belopp, vatRate: sats, vatMinor: moms, category: kategori, business: true, text: "" };
    for (var k in extra || {}) r[k] = extra[k];
    return r;
  }

  var år = new Date().getFullYear();
  var m = function (månad, dag) { return år + "-" + String(månad).padStart(2, "0") + "-" + String(dag).padStart(2, "0"); };

  var kvitton = [
    kvitto("D0000001-0000-4000-8000-000000000001", m(1, 12), "Foderkompaniet", "expense",
      [rad(638000, 25, 127600, "foder", { text: "Kraftfoder 25 kg × 20" })], 1, "done", "Kraftfoder"),
    kvitto("D0000001-0000-4000-8000-000000000002", m(1, 28), "Mejeriet Väst", "income",
      [rad(1680000, 12, 180000, "forsaljning", { text: "Mjölk januari" })], 2, "done", "Mjölkleverans"),
    kvitto("D0000001-0000-4000-8000-000000000003", m(2, 4), "Järnhandeln", "expense",
      [rad(38900, 25, 7780, "byggnader", { text: "Stängseltråd" }), rad(24900, 25, 4980, "byggnader", { text: "Krattor", business: false })],
      3, "done", "Stängsel"),
    kvitto("D0000001-0000-4000-8000-000000000004", m(2, 19), "Bensinmacken", "expense",
      [rad(124500, 25, 24900, "drivmedel", { text: "Diesel" })], 4, "done"),
    kvitto("D0000001-0000-4000-8000-000000000005", m(3, 2), "Veterinärkliniken", "expense",
      [rad(212500, 25, 42500, "tjanster")], 5, "done", "Besök och provtagning"),
    kvitto("D0000001-0000-4000-8000-000000000006", m(3, 15), "Lantbruksmaskiner", "expense",
      [rad(456000, 25, 91200, "maskiner", { text: "Reservdelar" }), rad(31200, 25, 6240, "osaker", { uncertain: true, text: "Arbetskläder" })],
      6, "done"),
    kvitto("D0000001-0000-4000-8000-000000000007", m(3, 20), "", "expense", [], 0, "toReview"),
  ];
  var bilder = {
    "D0000001-0000-4000-8000-000000000001": kvittobild("FODERKOMPANIET", [["Kraftfoder 25kg x20", "6 380,00"]], "6 380,00", "1 276,00"),
    "D0000001-0000-4000-8000-000000000002": kvittobild("MEJERIET VÄST", [["Mjölk jan, 3 400 l", "16 800,00"]], "16 800,00", "1 800,00"),
    "D0000001-0000-4000-8000-000000000003": kvittobild("JÄRNHANDELN", [["Stängseltråd", "389,00"], ["Krattor", "249,00"]], "638,00", "127,60"),
    "D0000001-0000-4000-8000-000000000004": kvittobild("BENSINMACKEN", [["Diesel 61,2 l", "1 245,00"]], "1 245,00", "249,00"),
    "D0000001-0000-4000-8000-000000000005": kvittobild("VETERINÄRKLINIKEN", [["Besök", "1 250,00"], ["Provtagning", "875,00"]], "2 125,00", "425,00"),
    "D0000001-0000-4000-8000-000000000006": kvittobild("LANTBRUKSMASKINER", [["Reservdelar", "4 560,00"], ["Arbetskläder", "312,00"]], "4 872,00", "974,40"),
    "D0000001-0000-4000-8000-000000000007": kvittobild("ÅKERBUTIKEN", [["Utsäde", "1 990,00"]], "1 990,00", "398,00"),
  };

  /** Samma gränssnitt som DriveKalla. */
  function DemoKalla() {}
  DemoKalla.prototype.konto = async function () { return "Exempelkonto"; };
  DemoKalla.prototype.läsAlla = async function (framsteg) {
    if (framsteg) framsteg(kvitton.length, kvitton.length);
    return kvitton.map(function (json) {
      var filer = {};
      filer[json.attachments[0].fileName] = json.id;
      return { json: json, filer: filer };
    });
  };
  DemoKalla.prototype.fil = async function (filID) { return bilder[filID]; };

  return { DemoKalla: DemoKalla };
})();
