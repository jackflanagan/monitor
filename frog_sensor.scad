// =====================================================
// Frog Plant Moisture Sensor Spike
// =====================================================
// Body    : 50mm W × 40mm D × 45mm H
// Spike   : 8mm W × 4mm D × 60mm L  (tapers to point)
// PCB Cavity : 30mm W × 20mm D × 25mm H (open bottom)
// LED Hole   : Ø5mm on forehead
// USB-C Slot : 10mm × 4mm on lower back
// Wall thickness : 2mm throughout
//
// Coordinate system:
//   +X = right, +Y = back, +Z = up (OpenSCAD default)
//   Front face at Y = -BD/2, back at Y = +BD/2
//   Spike extends downward (−Z) into soil
//
// To export STL:
//   openscad -o frog_sensor.stl frog_sensor.scad
// =====================================================

$fn = 64;

// ── Body dimensions ───────────────────────────────
BW = 50;   // width  (X)
BH = 45;   // height (Z)
BD = 40;   // depth  (Y)  — front is −Y

// ── Eye parameters ────────────────────────────────
EYE_R = 9;          // eye sphere radius
EYE_X = 13;         // horizontal offset from centre
EYE_Y = -BD * 0.1;  // slightly forward of body centre
EYE_Z = BH/2 - 3;   // near top of head

// ── Spike ─────────────────────────────────────────
SP_LEN = 60;  // length below body
SP_W   = 8;   // width  (X)
SP_T   = 4;   // thickness (Y)

// ── PCB cavity ────────────────────────────────────
CAV_W = 30;  // width  (X)
CAV_D = 20;  // depth  (Y)
CAV_H = 25;  // height (Z)

// ── Features ──────────────────────────────────────
LED_R = 2.5;   // LED hole radius → Ø5mm
ARM_R = 7;     // arm stub sphere radius
WALL  = 2;     // nominal wall thickness

// ─────────────────────────────────────────────────
// MODULES
// ─────────────────────────────────────────────────

module frog_body() {
    scale([BW/2, BD/2, BH/2])
        sphere(r = 1);
}

// Eye dome — sits on top of head
module eye_bump(sx) {
    translate([sx * EYE_X, EYE_Y, EYE_Z])
        sphere(r = EYE_R);
}

// Cut flat circular face on top of each eye (for sticker / decal)
module eye_flat_cut(sx) {
    translate([sx * EYE_X, EYE_Y, EYE_Z + EYE_R - 2.5])
        cylinder(r = EYE_R * 0.82, h = 8);
}

// Spike: rectangular cross-section at top, tapers to point
module spike() {
    translate([0, 0, -BH/2])
    hull() {
        cube([SP_W, SP_T, 1], center = true);
        translate([0, 0, -(SP_LEN + 0.5)])
            sphere(r = 0.5);
    }
}

// PCB cavity — open at the bottom so PCB slides in from below
module pcb_cavity() {
    translate([0, 0, -BH/2 + CAV_H/2 - 0.5])
        cube([CAV_W, CAV_D, CAV_H + 1], center = true);
}

// Ø5mm LED hole on forehead (front face, upper centre)
module led_hole() {
    translate([0, -BD * 0.46, BH * 0.18])
    rotate([90, 0, 0])
        cylinder(r = LED_R, h = 10, center = true);
}

// 10 × 4mm USB-C slot on lower back
module usb_slot() {
    translate([0, BD * 0.43, -BH * 0.20])
    rotate([90, 0, 0])
        cube([10, 4, 10], center = true);
}

// Small nostril bumps
module nostril(sx) {
    translate([sx * 5, -BD/2 + 1.2, BH * 0.03])
        sphere(r = 2.2);
}

// Curved smile groove — ∪ shape on front face
// Centre dips lower than ends for a happy expression
module smile_groove() {
    translate([0, -BD/2 + 0.6, -BH * 0.12]) {
        hull() {
            translate([-9, 0,  0])
                rotate([90, 0, 0]) cylinder(r = 1.5, h = 6, center = true);
            translate([ 0, 0, -4])   // centre dips down → smile
                rotate([90, 0, 0]) cylinder(r = 1.5, h = 6, center = true);
            translate([ 9, 0,  0])
                rotate([90, 0, 0]) cylinder(r = 1.5, h = 6, center = true);
        }
    }
}

// Front arm stubs
module arm_stub(sx) {
    translate([sx * (BW/2 + 2), -BD * 0.12, -BH * 0.08])
    rotate([0, sx * -12, sx * 8])
    scale([1.1, 0.75, 0.65])
        sphere(r = ARM_R);
}

// ─────────────────────────────────────────────────
// MAIN ASSEMBLY
// ─────────────────────────────────────────────────
difference() {
    union() {
        frog_body();
        eye_bump( 1);
        eye_bump(-1);
        nostril( 1);
        nostril(-1);
        arm_stub( 1);
        arm_stub(-1);
        spike();
    }

    // Subtractions
    pcb_cavity();    // hollow cavity for PCB (open bottom)
    led_hole();      // Ø5mm LED hole — forehead
    usb_slot();      // 10×4mm USB-C slot — lower back
    smile_groove();  // curved smile line
    eye_flat_cut( 1); // flat decal face — right eye
    eye_flat_cut(-1); // flat decal face — left eye
}
