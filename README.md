# @the-png-dev/skia-shaders

[![npm](https://img.shields.io/npm/v/@the-png-dev/skia-shaders)](https://www.npmjs.com/package/@the-png-dev/skia-shaders)
[![licence](https://img.shields.io/npm/l/@the-png-dev/skia-shaders)](./LICENSE)
[![CI](https://github.com/the-png-dev/skia-shaders/actions/workflows/ci.yml/badge.svg)](https://github.com/the-png-dev/skia-shaders/actions/workflows/ci.yml)

Shaders SKSL prets a l'emploi pour [`@shopify/react-native-skia`](https://github.com/Shopify/react-native-skia) :
une bibliotheque d'effets, un hook de compilation qui rend l'erreur lisible, et un
composant qui pose l'effet sur une image.

Vingt-sept effets, dont quatorze animes par l'horloge et deux pilotes au doigt. Aucune dependance directe : Skia, React et
React Native sont des `peerDependencies`.

## Installation

```bash
npm install @the-png-dev/skia-shaders
```

Le paquet suppose un projet Expo / React Native avec Metro et Babel, deja equipe de
`@shopify/react-native-skia` (>= 2.0) et, pour animer, de `react-native-reanimated`
(>= 3, optionnelle).

## Trois niveaux d'usage

**1. Le composant, pour un rendu fige.**

```tsx
import { ShaderImage } from "@the-png-dev/skia-shaders";

<ShaderImage
  shader="aurore"
  source={require("../assets/photo.jpg")}
  width={320}
  height={320}
  values={[0.75, 0.8]}          // les curseurs, dans l'ordre de declaration
/>
```

`values` est optionnel : sans lui, l'effet s'applique tel qu'ecrit. Les reglages se
passent **positionnellement**, dans l'ordre de `SHADERS.find(...).sliders`, ce qui
evite d'ecrire un nom d'uniform a la main — c'est justement ce genre d'appariement
qui fait planter un runtime effect.

**2. Le noeud, pour composer dans son propre canvas.**

```tsx
import { Canvas, Group } from "@shopify/react-native-skia";
import { ShaderLayer, useShaderEffect, packUniforms } from "@the-png-dev/skia-shaders";

const { effect, error } = useShaderEffect("vortex");
const uniforms = packUniforms(def, [2.5, 0.8], { width, height, split: 0, time: 0 });

<Canvas style={style}>
  <ShaderLayer compiled={{ effect, error }} image={img} width={w} height={h} uniforms={uniforms} />
</Canvas>
```

`useShaderEffect` ne fait jamais confiance a Skia en silence : `RuntimeEffect.Make`
renvoie `null` quand le SKSL est refuse, et le message est rendu dans `error` au lieu
de produire un canvas vide.

**3. L'animation, sur le thread UI.**

```tsx
const clock = useSharedValue(0);
const last = useSharedValue(-1);
useFrameCallback((info) => {
  "worklet";
  let dt = last.value < 0 ? 1 / 60 : (info.timestamp - last.value) / 1000;
  last.value = info.timestamp;
  if (dt > 1 / 30) dt = 1 / 30;
  clock.value += dt;                       // integre, jamais multiplie
});

const uniforms = useDerivedValue(() =>
  packUniforms(def, [a.value, b.value], { width, height, split: 0, time: clock.value }),
);
```

## Un shader n'est pas seulement anime, il peut etre touche

`magnify` (la loupe) lit `pointer` ; `mosaic` lit `pointer` **et** `progress` (0 a 1, la
montee du front). Un effet tactile n'est oblige de lire aucun des deux : la garde
verifie seulement que `fx()` en lit au moins un, sinon le contrat d'hote est paye
pour rien. Les deux ont un defaut
servi par `packUniforms` — le centre et `1` — donc **au repos l'image est resolue**
et l'effet ne peut pas rester bloque en etat trouble si l'hote oublie de les animer.

```tsx
const px = useSharedValue(width / 2);
const py = useSharedValue(height / 2);
const progress = useSharedValue(1);

const tap = Gesture.Tap().onEnd((e) => {
  "worklet";
  px.value = e.x;
  py.value = e.y;
  progress.value = 0;
  progress.value = withTiming(1, { duration: 2600, easing: Easing.out(Easing.cubic) });
});

const uniforms = useDerivedValue(() =>
  packUniforms(def, [], { width, height, split: 0, time: 0,
                          pointer: [px.value, py.value], progress: progress.value }),
);
```

La portee du front doit etre calculee depuis le **pointer**, pas depuis la taille du
cadre : `length(max(pointer, resolution - pointer))` est la distance au coin le plus
lointain. Ecrire `length(resolution)` par defaut fait tout basculer aux alentours de
`progress = 0,4` et laisse les deux tiers de l'animation sans effet — c'est exactement
ce que la premiere version de `mosaic` a fait, et seule une mesure frame par frame
l'a montre.

## La regle de l'horloge

**Un shader anime ne recoit jamais de curseur de vitesse.** La vitesse est appliquee
a l'exterieur, en integrant `clock += dt * vitesse` : changer la vitesse ne deplace
alors que le taux, jamais la phase deja atteinte. Un shader qui calculait
`time * vitesse` en interne faisait sauter l'animation a chaque coup de curseur —
c'est le motif pour lequel `time` arrive ici deja monte.

Consequence pour les shaders qui **deplacent** des pixels : la garde de cadre est
obligatoire. `image.eval()` hors de l'image rend transparent, donc un seul canal
s'eteint et le bord se colore. `packUniforms` sert `resolution` ; a toi de tester
`p.x < 0.0 || p.y < 0.0 || p.x > resolution.x || p.y > resolution.y` et de retomber
sur l'echantillon central.

## Ce que le paquet garantit, et ce qu'il ne garantit pas

- Le rendu passe par **un seul** noeud, `<Fill><Shader><ImageShader/></Shader></Fill>`,
  verifie sur l'appareil. Un equivalent en `<Rect><Paint><Shader>` compile mais ne
  dessine rien : si tu mets un shader dans un `Paint` de forme et que l'ecran reste
  noir, c'est ca.
- Dans une grille, les coordonnees recues par `main()` sont **locales au `<Group>`**
  qui translate la cellule. `resolution` doit donc valoir la taille de la cellule,
  et le `<Group>` doit porter le `clip` ainsi que le `transform`.
- Les sources sont livrees en TypeScript (`react-native` pointe sur `src/`) :
  Metro et Babel les compilent comme le reste de l'app. `npm run build` ajoute
  la sortie compilee (`lib/commonjs`, `lib/module`, `lib/typescript`) et un
  `exports` a conditions, publies avec le paquet, pour les consommateurs Node
  (SSR, Jest sans transform).
- Le paquet ne depend d'aucun alias du projet hote : aucun `@/...`, aucun `require()`.
  C'est verifie par `scripts/tests/verify-shader-playground.mjs` dans le depot.

## Limites connues

- « Neon » garde un liseré colore d'un pixel sur les bords haut et gauche de l'image.
  Le recadrage des taps de gradient n'y a rien change ; la cause reste a etablir.
- Les effets a bruit (`aurore`, `caustics`, `cells`, `bokeh`) sont les plus couteux :
  une grille entiere de vignettes animees ne tiendra pas a 60 images par seconde.
  La grille de demonstration fige volontairement `time = 0`.

## Licence

MIT
