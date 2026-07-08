// The ALIEN's brain (UpdateAlienAI). Runs when its action countdown is parked.
// Crew never act autonomously — only the alien and (once active) the android do.
(function (root) {
  var A = (root.ALIEN = root.ALIEN || {});
  var D = A.data, MV = A.movement;

  function updateAlienAI(s, rng) {
    var alien = s.actors[0];
    if (alien.t !== 0) return; // still busy with a queued action

    // duct-escape guard: rescue the alien from an out-of-bounds duct spot
    // ("over the Narcissus") by dropping it back onto the floor.
    if ((alien.room & 64) && (alien.room & 63) >= 34) alien.room &= 63;

    // 1. crew (or corpses) share its spot -> attack tick.
    var victims = MV.occupantsAt(s, alien.room, MV.CREW);
    if (victims.length > 0) { alien.state = 5; alien.t = D.K.ALIEN_ATTACK_T; return; }

    var room = alien.room & 63;
    var grille = room < 34 ? s.roomGrille[room] : 0;

    // 2. alone, grille in place -> 3/16 (direction 0) rip it out itself.
    if (grille === 255) {
      if (rng.direction() === 0) { alien.state = 3; alien.t = D.K.ALIEN_GRILLE_T; return; }
    } else {
      // 3. alone, grille open -> 6/16 (direction 0 or 1) slip through it.
      if (rng.direction() < 2) {
        alien.dest = alien.room ^ 64;
        alien.state = 2; alien.t = D.K.ALIEN_GRILLE_T; return;
      }
    }

    // 4. wander; damages the room if the roll leaves it where it stands.
    MV.pickNextRoom(s, 0, rng);
    alien.t = D.K.ALIEN_WANDER_T;
    alien.state = 1;
    if (alien.dest === alien.room) A.ship.addRoomDamage(s, alien.room, 1);
  }

  A.alienai = { updateAlienAI: updateAlienAI };
  if (typeof module !== "undefined" && module.exports) module.exports = A.alienai;
})(typeof window !== "undefined" ? window : this);
