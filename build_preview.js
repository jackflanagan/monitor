const fs = require('fs');
const stlB64 = fs.readFileSync('frog_sensor.stl').toString('base64');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Frog Sensor — 3D Preview</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #111e14; overflow: hidden; font-family: 'Segoe UI', sans-serif; }
  canvas { display: block; }
  #panel {
    position: fixed; top: 18px; left: 18px;
    background: rgba(0,0,0,0.78); backdrop-filter: blur(10px);
    color: #fff; padding: 18px 22px; border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.1); min-width: 220px; user-select: none;
  }
  #panel h2 { font-size: 17px; margin-bottom: 14px; color: #44ff88; letter-spacing: -0.02em; }
  .row { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 6px; }
  .row .lbl { color: #777; } .row .val { color: #ddd; font-family: monospace; }
  hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 13px 0; }
  .btn {
    display: block; width: 100%; padding: 9px 12px; margin-bottom: 8px;
    background: rgba(68,255,136,0.12); border: 1px solid rgba(68,255,136,0.4);
    color: #44ff88; border-radius: 8px; cursor: pointer; font-size: 12px;
    transition: background 0.2s; text-align: left;
  }
  .btn:last-child { margin-bottom: 0; }
  .btn:hover { background: rgba(68,255,136,0.25); }
  .btn.on { background: rgba(68,255,136,0.3); border-color: #44ff88; }
  #loading {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    background: #111e14; color: #44ff88; font-size: 14px; font-family: monospace; z-index: 10;
  }
  #stats {
    position: fixed; top: 18px; right: 18px;
    background: rgba(0,0,0,0.78); backdrop-filter: blur(10px);
    color: #fff; padding: 16px 18px; border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.1); font-size: 12px; user-select: none;
  }
  #stats h3 { font-size: 12px; color: #888; margin-bottom: 10px; text-transform: uppercase; letter-spacing: 0.08em; }
  #hint {
    position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%);
    background: rgba(0,0,0,0.6); color: #666; padding: 9px 22px;
    border-radius: 8px; font-size: 12px; white-space: nowrap; pointer-events: none;
  }
</style>
</head>
<body>
<div id="loading">🐸 Loading STL…</div>
<div id="panel">
  <h2>🐸 Frog Sensor</h2>
  <div class="row"><span class="lbl">Body</span><span class="val">50 × 40 × 45 mm</span></div>
  <div class="row"><span class="lbl">Spike</span><span class="val">8 × 4 × 60 mm</span></div>
  <div class="row"><span class="lbl">PCB Cavity</span><span class="val">30 × 20 × 25 mm</span></div>
  <div class="row"><span class="lbl">LED Hole</span><span class="val">Ø5 mm forehead</span></div>
  <div class="row"><span class="lbl">USB-C Slot</span><span class="val">10 × 4 mm back</span></div>
  <div class="row"><span class="lbl">Wall</span><span class="val">2 mm</span></div>
  <hr>
  <button class="btn" id="btn-wire"   onclick="toggleWire()">🔲 Wireframe</button>
  <button class="btn" id="btn-color"  onclick="cycleColor()">🎨 Colour: Green</button>
  <button class="btn" id="btn-rotate" onclick="toggleRotate()">🔄 Auto-rotate: On</button>
</div>
<div id="stats">
  <h3>Mesh Info</h3>
  <div class="row"><span class="lbl">Triangles</span><span class="val" id="stat-tris">—</span></div>
  <div class="row"><span class="lbl">Vertices</span><span class="val" id="stat-verts">—</span></div>
  <div class="row"><span class="lbl">File</span><span class="val">frog_sensor.stl</span></div>
</div>
<div id="hint">🖱 Drag to rotate · Scroll to zoom · Right-drag to pan</div>
<script src="https://cdn.jsdelivr.net/npm/three@0.134.0/build/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.134.0/examples/js/controls/OrbitControls.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.134.0/examples/js/loaders/STLLoader.js"></script>
<script>
const STL_B64 = "${stlB64}";

function b64ToBuffer(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111e14);
scene.fog = new THREE.FogExp2(0x111e14, 0.004);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 2000);
camera.position.set(-90, 60, -130);

const controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.update();

scene.add(new THREE.AmbientLight(0xd0ffe0, 0.55));
const sun = new THREE.DirectionalLight(0xfff8e8, 1.1);
sun.position.set(80, 120, -60); sun.castShadow = true; scene.add(sun);
const fill = new THREE.DirectionalLight(0x88ccff, 0.4);
fill.position.set(-60, 30, 80); scene.add(fill);
const rim = new THREE.DirectionalLight(0x00ff88, 0.3);
rim.position.set(40, 20, 100); scene.add(rim);

const potMat = new THREE.MeshPhongMaterial({ color: 0x9b5c2a, shininess: 15 });
const pot = new THREE.Mesh(new THREE.CylinderGeometry(34, 28, 42, 40), potMat);
scene.add(pot);
const potRim = new THREE.Mesh(new THREE.TorusGeometry(34, 2.5, 12, 40), potMat);
potRim.rotation.x = Math.PI / 2; scene.add(potRim);
const soil = new THREE.Mesh(new THREE.CircleGeometry(32, 40),
  new THREE.MeshPhongMaterial({ color: 0x2e1a0a, shininess: 3 }));
soil.rotation.x = -Math.PI / 2; scene.add(soil);

const colours = [
  { name: 'Green', hex: 0x2db840 }, { name: 'Lime', hex: 0x88ff22 },
  { name: 'Ocean Blue', hex: 0x2255cc }, { name: 'Orange', hex: 0xff6622 },
  { name: 'White', hex: 0xf0f0f0 }, { name: 'Graphite', hex: 0x444444 },
];
let colourIdx = 0;
const frogMat = new THREE.MeshPhongMaterial({
  color: colours[0].hex, specular: 0x88ee88, shininess: 38, side: THREE.DoubleSide
});

let autoRotate = true;

const geometry = new THREE.STLLoader().parse(b64ToBuffer(STL_B64));
geometry.computeVertexNormals();
geometry.computeBoundingBox();
const centre = new THREE.Vector3();
geometry.boundingBox.getCenter(centre);
geometry.translate(-centre.x, -centre.y, -centre.z);
geometry.computeBoundingBox();

const frogMesh = new THREE.Mesh(geometry, frogMat);
frogMesh.castShadow = true;
scene.add(frogMesh);

const bottom = geometry.boundingBox.min.y;
pot.position.y = bottom - 21;
potRim.position.y = bottom;
soil.position.y = bottom;
controls.target.set(0, 0, 0);
controls.update();

document.getElementById('stat-tris').textContent  = Math.round(geometry.attributes.position.count / 3).toLocaleString();
document.getElementById('stat-verts').textContent = geometry.attributes.position.count.toLocaleString();
document.getElementById('loading').style.display = 'none';

function toggleWire() {
  frogMat.wireframe = !frogMat.wireframe;
  const b = document.getElementById('btn-wire');
  b.textContent = frogMat.wireframe ? '🔲 Solid' : '🔲 Wireframe';
  b.classList.toggle('on', frogMat.wireframe);
}
function cycleColor() {
  colourIdx = (colourIdx + 1) % colours.length;
  frogMat.color.setHex(colours[colourIdx].hex);
  document.getElementById('btn-color').textContent = '🎨 Colour: ' + colours[colourIdx].name;
}
function toggleRotate() {
  autoRotate = !autoRotate;
  document.getElementById('btn-rotate').textContent = '🔄 Auto-rotate: ' + (autoRotate ? 'On' : 'Off');
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  if (autoRotate) frogMesh.rotation.y += clock.getDelta() * 0.4;
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
</script>
</body>
</html>`;

fs.writeFileSync('frog_sensor_render.html', html);
console.log('Done. Size:', (fs.statSync('frog_sensor_render.html').size / 1024 / 1024).toFixed(1) + 'MB');
