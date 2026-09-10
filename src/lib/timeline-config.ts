/**
 * Maximum zoom-in, expressed as the fewest number of frames that may fill the
 * visible view. Zooming in further provides no meaningful precision benefit, so
 * this caps both the navigator window and scroll-to-zoom on the main timeline.
 */
export const MIN_VISIBLE_FRAMES = 30
