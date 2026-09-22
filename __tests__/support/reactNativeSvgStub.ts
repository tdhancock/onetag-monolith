// Shared `react-native-svg` stub. The icons import Svg/Path/Circle/G/Rect
// at module load; suites that only inspect the element tree they build
// (rather than render to a DOM) need nothing more than inert pass-through
// components.

import React from 'react';

const makeStub = (name: string) => {
  const Stub: React.FC<Record<string, unknown>> = () => null;
  Stub.displayName = name;
  return Stub;
};

export const Svg = makeStub('Svg');
export const Path = makeStub('Path');
export const Circle = makeStub('Circle');
export const G = makeStub('G');
export const Rect = makeStub('Rect');
export default Svg;
