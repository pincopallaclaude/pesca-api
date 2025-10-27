// /lib/utils/geo.utils.js

/**
 * Calcola la distanza tra due coordinate (formula Haversine) e verifica se sono vicine.
 * @param {string} coords1 - "lat,lon" della prima coordinata.
 * @param {string} coords2 - "lat,lon" della seconda coordinata.
 * @param {number} toleranceKm - Tolleranza in chilometri.
 * @returns {boolean}
 */
function areCoordsNear(coords1, coords2, toleranceKm = 1) {
    const [lat1_str, lon1_str] = coords1.split(',');
    const [lat2_str, lon2_str] = coords2.split(',');

    const lat1 = parseFloat(lat1_str);
    const lon1 = parseFloat(lon1_str);
    const lat2 = parseFloat(lat2_str);
    const lon2 = parseFloat(lon2_str);

    const R = 6371; // Raggio della Terra in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
        0.5 - Math.cos(dLat)/2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * (1 - Math.cos(dLon))/2;
    
    const distance = R * 2 * Math.asin(Math.sqrt(a));
    
    return distance < toleranceKm;
}


/**
 * Normalizza coordinate a 3 decimali
 * @param {number|string} lat - Latitudine
 * @param {number|string} lon - Longitudine
 * @returns {Object} { lat, lon } normalizzati
 */
function normalizeCoords(lat, lon) {
  return {
    lat: parseFloat(lat).toFixed(3),
    lon: parseFloat(lon).toFixed(3)
  };
}

export { areCoordsNear, normalizeCoords };