// Shared `expo-image` stub. Renders nothing — suites that use it only
// inspect the props the component tree was built with, never a mounted
// image.

import React from 'react';

const ImageComponent: React.FC<Record<string, unknown>> = () => null;
ImageComponent.displayName = 'Image';

export const Image = ImageComponent;
