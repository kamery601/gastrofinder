(function (global) {
  const PIN_COLORS = {
    open: '#639922',
    closed: '#E24B4A',
    unknown: '#888780'
  };

  function createMapView(containerId) {
    const container = document.getElementById(containerId);
    let map = null;
    let markerLayer = null;
    let userMarker = null;

    function ensureMap(center) {
      if (!global.L || !container) return null;

      if (!map) {
        map = global.L.map(container, {
          zoomControl: true,
          scrollWheelZoom: false
        }).setView([center.lat, center.lng], 14);

        global.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(map);

        markerLayer = global.L.layerGroup().addTo(map);
      } else {
        map.setView([center.lat, center.lng], map.getZoom() || 14);
      }

      setTimeout(() => map.invalidateSize(), 0);
      return map;
    }

    function makePinIcon(status) {
      const color = PIN_COLORS[status] || PIN_COLORS.unknown;
      return global.L.divIcon({
        className: 'gf-pin-wrap',
        html: `<span class="gf-pin" style="background:${color}"></span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
        popupAnchor: [0, -10]
      });
    }

    function popupHtml(place, statusLabel, formatDistance, esc) {
      const rating = place.rating ? place.rating.toFixed(1) : '–';
      const distance = place.distanceKm != null ? formatDistance(place.distanceKm) : '–';
      return `
        <div class="gf-popup">
          <strong>${esc(place.name)}</strong>
          <div class="gf-popup-meta">${statusLabel}</div>
          <div class="gf-popup-meta">⭐ ${rating}${place.ratingCount ? ` (${place.ratingCount.toLocaleString('pl')})` : ''}</div>
          <div class="gf-popup-meta">📍 ${distance}</div>
          <a href="${place.mapsUrl}" target="_blank" rel="noopener">Google Maps</a>
        </div>`;
    }

    function setUserLocation(lat, lng) {
      if (!map || !global.L) return;
      if (userMarker) userMarker.remove();
      userMarker = global.L.circleMarker([lat, lng], {
        radius: 7,
        color: '#2563EB',
        fillColor: '#2563EB',
        fillOpacity: 0.85,
        weight: 2
      }).addTo(map).bindPopup('Twoja lokalizacja');
    }

    function renderMarkers(places, center, helpers) {
      if (!container) return;

      if (!places.length || !center) {
        container.style.display = 'none';
        return;
      }

      container.style.display = 'block';
      ensureMap(center);
      if (!markerLayer) return;

      markerLayer.clearLayers();

      const bounds = [];
      places.forEach((place) => {
        if (place.lat == null || place.lng == null) return;
        const openStatus = helpers.getOpenStatus(place);
        const status = openStatus === true ? 'open' : openStatus === false ? 'closed' : 'unknown';
        const statusLabel = openStatus === true ? 'Otwarte' : openStatus === false ? 'Zamknięte' : 'Brak danych';
        const marker = global.L.marker([place.lat, place.lng], {
          icon: makePinIcon(status)
        });
        marker.bindPopup(popupHtml(place, statusLabel, helpers.formatDistance, helpers.esc));
        markerLayer.addLayer(marker);
        bounds.push([place.lat, place.lng]);
      });

      if (bounds.length) {
        map.fitBounds(bounds, { padding: [28, 28], maxZoom: 16 });
      }
    }

    function hide() {
      if (container) container.style.display = 'none';
    }

    function destroy() {
      if (map) {
        map.remove();
        map = null;
        markerLayer = null;
        userMarker = null;
      }
      hide();
    }

    return {
      renderMarkers,
      setUserLocation,
      hide,
      destroy
    };
  }

  global.GastroMap = { createMapView };
})(window);
