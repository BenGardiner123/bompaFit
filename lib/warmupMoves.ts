// Common warm-up and mobility moves, offered as a quick pick in the builder and
// used for the one-line cue on Train. Written for Bompa; kept out of the
// startup bundle and loaded only when a warm-up is on screen, because nothing
// here is needed to log a set.

export type WarmupMove = {
  name: string;
  /** A sensible starting dose. The lifter can change it. */
  dose: string;
  /** One sentence, said to the lifter. */
  cue: string;
};

export const WARMUP_MOVES: readonly WarmupMove[] = [
  { name: 'Cat-cow', dose: '8 slow', cue: 'On hands and knees, round your back up tall, then let your belly sink and lift your chest — move one vertebra at a time.' },
  { name: 'Hip aeroplanes', dose: '5 each side', cue: 'Balance on one leg with a soft knee, hinge forward, then slowly open your hips to the side and close them again.' },
  { name: "World's greatest stretch", dose: '4 each side', cue: 'Step into a long lunge, put the same-side elbow down towards your instep, then turn and reach that arm to the ceiling.' },
  { name: '90/90 hip switches', dose: '6 each side', cue: 'Sit with both knees bent at right angles to one side, then swing both knees over to the other side without using your hands if you can.' },
  { name: 'Band pull-aparts', dose: '15', cue: 'Hold a light band at shoulder height with straight arms and pull it apart until it touches your chest, squeezing your shoulder blades.' },
  { name: 'Band pass-throughs', dose: '10', cue: 'Hold a band wide with straight arms and take it over your head and behind you, then back — widen your grip if your elbows bend.' },
  { name: 'Band marches', dose: '10 each side', cue: 'With a mini-band round your feet, lie on your back or stand tall and drive one knee up against the band without letting your lower back arch.' },
  { name: 'Monster walks', dose: '10 steps each way', cue: 'Mini-band above your knees, sit into a quarter squat and take wide, slow steps, keeping your knees pushed out against the band.' },
  { name: 'Glute bridges', dose: '12', cue: 'Lie on your back with feet flat, push through your heels and lift your hips until you are straight from knee to shoulder, then pause.' },
  { name: 'Dead bugs', dose: '6 each side', cue: 'On your back with arms up and knees over hips, lower the opposite arm and leg slowly while keeping your lower back pressed down.' },
  { name: 'Bird dogs', dose: '6 each side', cue: 'On hands and knees, reach one arm forward and the opposite leg back, hold for a breath, and keep your hips level.' },
  { name: 'Open books', dose: '6 each side', cue: 'Lie on your side with knees bent, arms out in front, and open your top arm across to the floor behind you, following it with your eyes.' },
  { name: 'Knee-to-wall ankle rocks', dose: '10 each side', cue: 'Face a wall in a half-kneeling stance and rock your front knee towards the wall over your toes, keeping the heel down.' },
  { name: 'Scap push-ups', dose: '10', cue: 'In a push-up position with straight arms, let your chest sink between your shoulder blades, then push the floor away to spread them.' },
  { name: 'Cossack squats', dose: '5 each side', cue: 'Stand wide and shift into one hip, bending that knee while the other leg stays straight with its toes up — go only as deep as feels smooth.' },
  { name: 'Leg swings', dose: '10 each way', cue: 'Hold something for balance and swing one leg forward and back, then side to side, letting the range grow a little each swing.' },
  { name: 'Walking lunges with reach', dose: '5 each side', cue: 'Step into a lunge and reach both arms overhead, leaning slightly away from the front leg to stretch the hip at the back.' },
  { name: 'Inchworms', dose: '5', cue: 'From standing, fold forward, walk your hands out to a plank, then walk your feet up to your hands with legs as straight as is comfortable.' },
  { name: 'Spiderman lunge with rotation', dose: '4 each side', cue: 'From a plank, step one foot outside its hand, sink your hips, then rotate and reach the inside arm up.' },
  { name: 'Bodyweight good mornings', dose: '10', cue: 'Hands behind your head and knees soft, push your hips back until you feel the backs of your legs, then stand tall.' },
  { name: 'Wrist circles', dose: '10 each way', cue: 'Clasp your hands or make loose fists and roll your wrists in slow, full circles in both directions.' },
  { name: 'Arm circles', dose: '10 each way', cue: 'Arms out to the sides, draw small circles and let them grow bigger, then reverse the direction.' },
  { name: 'Deep squat hold', dose: '30 s', cue: 'Sit down into your deepest comfortable squat, heels down, and use your elbows to gently press your knees out.' },
  { name: 'Hip flexor stretch', dose: '30 s each side', cue: 'Half-kneel, tuck your tailbone under and squeeze the glute of the back leg until you feel the front of that hip open.' },
  { name: 'Thread the needle', dose: '6 each side', cue: 'On hands and knees, slide one arm under your body along the floor, then sweep it up towards the ceiling as you turn your chest.' },
];
