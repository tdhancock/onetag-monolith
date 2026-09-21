

/// <reference types="nativewind/types" />

// global.css is imported for its side effects in app/_layout.tsx so NativeWind
// can process it. TypeScript needs to know a bare .css import is legal.
declare module '*.css';
