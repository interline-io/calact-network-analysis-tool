/**
 * Color utilities for map styling
 * Uses d3-scale-chromatic for accessible, perceptually-uniform color schemes
 * See: https://d3js.org/d3-scale-chromatic/categorical
 */

import { scaleOrdinal } from 'd3-scale'
import {
  schemeTableau10,
  schemeSet2,
  schemeCategory10,
} from 'd3-scale-chromatic'

/**
 * Default categorical color scheme for general use (routes, agencies, etc.)
 * Tableau10 is designed for data visualization with good contrast and accessibility
 */
export const categoricalColors = schemeTableau10

/**
 * Alternative color schemes for different contexts
 */
export const colorSchemes = {
  // Tableau10: 10 distinct colors, good for agencies
  tableau10: schemeTableau10,
  // Set2: 8 pastel colors, good for overlapping areas
  set2: schemeSet2,
  // Category10: Classic D3 colors
  category10: schemeCategory10,
} as const

/**
 * Flex Services color configuration
 * Uses colors with transparency suitable for overlapping polygons
 */
export const flexColors = {
  // Colors for "Color by Agency" mode
  // Using Tableau10 which has good perceptual distinction
  agency: schemeTableau10,

  // Colors for "Color by Advance notice" mode
  // Three distinct colors for the three booking_type categories
  advanceNotice: {
    'On-demand': '#2ca02c', // Green - immediate availability
    'Same day': '#ff7f0e', // Orange - some planning needed
    'More than 24 hours': '#d62728', // Red - advance booking required
  },

  // Default/fallback color
  default: '#888888',
} as const

/**
 * Flex polygon styling configuration
 * Designed for overlapping polygons with transparency
 */
export const flexPolygonStyle = {
  // Fill opacity - lower for overlapping areas
  fillOpacity: 0.25,
  // Stroke (outline) opacity
  strokeOpacity: 0.8,
  // Stroke width
  strokeWidth: 1.5,
  // Hover state
  hoverFillOpacity: 0.4,
  hoverStrokeWidth: 2.5,
} as const

/**
 * Create an ordinal scale for mapping categories to colors
 * @param categories - Array of category names
 * @param colorScheme - Color scheme to use (defaults to Tableau10)
 * @returns D3 ordinal scale function
 */
export function createCategoryColorScale (
  categories: string[],
  colorScheme: readonly string[] = schemeTableau10
) {
  return scaleOrdinal<string, string>()
    .domain(categories)
    .range(colorScheme as string[])
}

/**
 * Get color for a flex service area based on the color mode
 * @param colorBy - 'Agency' or 'Advance notice'
 * @param value - The agency name or advance notice category
 * @param agencyColorScale - Optional pre-computed agency color scale
 * @returns Hex color string
 */
export function getFlexAreaColor (
  colorBy: 'Agency' | 'Advance notice',
  value: string,
  agencyColorScale?: ReturnType<typeof createCategoryColorScale>
): string {
  if (colorBy === 'Advance notice') {
    return flexColors.advanceNotice[value as keyof typeof flexColors.advanceNotice]
      || flexColors.default
  }

  // Agency coloring
  if (agencyColorScale) {
    return agencyColorScale(value)
  }

  // Fallback if no scale provided
  return flexColors.default
}

/**
 * Generate GeoJSON properties for flex polygon styling
 * @param color - Base color for the polygon
 * @param isHighlighted - Whether the polygon is highlighted/hovered
 * @returns GeoJSON simplestyle properties
 */
export function getFlexPolygonProperties (
  color: string,
  isHighlighted = false
): Record<string, string | number> {
  return {
    'fill': color,
    'fill-opacity': isHighlighted
      ? flexPolygonStyle.hoverFillOpacity
      : flexPolygonStyle.fillOpacity,
    'stroke': color,
    'stroke-opacity': flexPolygonStyle.strokeOpacity,
    'stroke-width': isHighlighted
      ? flexPolygonStyle.hoverStrokeWidth
      : flexPolygonStyle.strokeWidth,
  }
}
