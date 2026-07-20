// Central tourist-region configuration - a pure navigation layer on top of the
// existing search. Same UMD pattern as countries.js: window.GastroRegions in
// the browser, require()-able in Node for tests. Regions NEVER touch the search
// engine, ranking, filters or Google API usage - clicking a place simply runs
// the exact search the user could have typed by hand.
//
// Each place has a stable `id`, a display `label` (Polish UI), and an explicit
// `query` sent to the geocoder - so a future Polish exonym, alternate spelling,
// ordering, highlight, start coordinates or a Tatry Razem deep-link can be
// added per place without migrating the structure.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GastroRegions = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const REGIONS = {
    PL: [
      {
        id: 'podhale-tatry',
        label: 'Podhale i Tatry',
        emoji: '🏔️',
        places: [
          { id: 'zakopane', label: 'Zakopane', query: 'Zakopane' },
          { id: 'bialka-tatrzanska', label: 'Białka Tatrzańska', query: 'Białka Tatrzańska' },
          { id: 'bukowina-tatrzanska', label: 'Bukowina Tatrzańska', query: 'Bukowina Tatrzańska' },
          { id: 'koscielisko', label: 'Kościelisko', query: 'Kościelisko' },
          { id: 'poronin', label: 'Poronin', query: 'Poronin' }
        ]
      },
      {
        id: 'pieniny',
        label: 'Pieniny',
        emoji: '🚣',
        places: [
          { id: 'szczawnica', label: 'Szczawnica', query: 'Szczawnica' },
          { id: 'kroscienko', label: 'Krościenko', query: 'Krościenko nad Dunajcem' },
          { id: 'niedzica', label: 'Niedzica', query: 'Niedzica' }
        ]
      },
      {
        id: 'krakow-okolice',
        label: 'Kraków i okolice',
        emoji: '🏰',
        places: [
          { id: 'krakow', label: 'Kraków', query: 'Kraków' },
          { id: 'wieliczka', label: 'Wieliczka', query: 'Wieliczka' }
        ]
      }
    ],
    SK: [
      {
        id: 'tatry-wysokie',
        label: 'Tatry Wysokie',
        emoji: '🏔️',
        places: [
          { id: 'poprad', label: 'Poprad', query: 'Poprad' },
          { id: 'stary-smokovec', label: 'Starý Smokovec', query: 'Starý Smokovec' },
          { id: 'tatranska-lomnica', label: 'Tatrzańska Łomnica', query: 'Tatranská Lomnica' },
          { id: 'strbske-pleso', label: 'Štrbské Pleso', query: 'Štrbské Pleso' },
          { id: 'zdiar', label: 'Zdziar', query: 'Ždiar' },
          { id: 'kezmarok', label: 'Kieżmark', query: 'Kežmarok' }
        ]
      },
      {
        id: 'liptov-jasna',
        label: 'Liptów i Jasná',
        emoji: '⛷️',
        places: [
          { id: 'liptovsky-mikulas', label: 'Liptowski Mikułasz', query: 'Liptovský Mikuláš' },
          { id: 'besenova', label: 'Bešeňová', query: 'Bešeňová' },
          { id: 'demanovska-dolina', label: 'Demänovská Dolina', query: 'Demänovská Dolina' },
          { id: 'ruzomberok', label: 'Rużomberk', query: 'Ružomberok' }
        ]
      },
      {
        id: 'orava',
        label: 'Orawa',
        emoji: '🌲',
        places: [
          { id: 'namestovo', label: 'Namiestów', query: 'Námestovo' },
          { id: 'dolny-kubin', label: 'Dolný Kubín', query: 'Dolný Kubín' },
          { id: 'oravsky-podzamok', label: 'Oravský Podzámok', query: 'Oravský Podzámok' }
        ]
      },
      {
        id: 'duze-miasta-sk',
        label: 'Duże miasta',
        emoji: '🏙️',
        places: [
          { id: 'bratislava', label: 'Bratysława', query: 'Bratislava' },
          { id: 'kosice', label: 'Koszyce', query: 'Košice' },
          { id: 'zilina', label: 'Żylina', query: 'Žilina' },
          { id: 'banska-bystrica', label: 'Bańska Bystrzyca', query: 'Banská Bystrica' }
        ]
      }
    ],
    HU: [
      {
        id: 'termy-polnocny-wschod',
        label: 'Termy północno-wschodnie',
        emoji: '♨️',
        places: [
          { id: 'hajduszoboszlo', label: 'Hajdúszoboszló', query: 'Hajdúszoboszló' },
          { id: 'eger', label: 'Eger', query: 'Eger' },
          { id: 'miskolctapolca', label: 'Miskolctapolca', query: 'Miskolctapolca' },
          { id: 'debrecen', label: 'Debreczyn', query: 'Debrecen' }
        ]
      },
      {
        id: 'budapeszt-okolice',
        label: 'Budapeszt i okolice',
        emoji: '🏛️',
        places: [
          { id: 'budapest', label: 'Budapeszt', query: 'Budapest' },
          { id: 'szentendre', label: 'Szentendre', query: 'Szentendre' },
          { id: 'gyor', label: 'Győr', query: 'Győr' }
        ]
      },
      {
        id: 'balaton',
        label: 'Balaton',
        emoji: '🌊',
        places: [
          { id: 'heviz', label: 'Hévíz', query: 'Hévíz' },
          { id: 'siofok', label: 'Siófok', query: 'Siófok' },
          { id: 'balatonfured', label: 'Balatonfüred', query: 'Balatonfüred' }
        ]
      }
    ]
  };

  /**
   * Regions for a country code; empty array (never undefined) for a country
   * without configured regions, so the UI can simply hide the row.
   * @param {string} countryCode
   * @returns {object[]}
   */
  function getRegions(countryCode) {
    return REGIONS[String(countryCode || '').toUpperCase()] || [];
  }

  /**
   * @returns {object|null} the region with this id inside a country, or null
   */
  function getRegion(countryCode, regionId) {
    return getRegions(countryCode).find((r) => r.id === regionId) || null;
  }

  return { REGIONS, getRegions, getRegion };
});
