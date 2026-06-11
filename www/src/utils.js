function colorFor(v) {
  return v < 30 ? '#ffb830' : v >= 70 ? '#4aadff' : '#5aff7e';
}

function urlBase64ToUint8Array(base64String) {
  var padding = '='.repeat((4 - base64String.length % 4) % 4);
  var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  var rawData = atob(base64);
  return Uint8Array.from([...rawData].map(function(c) { return c.charCodeAt(0); }));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { colorFor, urlBase64ToUint8Array };
}
