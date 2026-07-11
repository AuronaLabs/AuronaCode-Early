export type GlassIntensity = 'disabled' | 'light' | 'medium' | 'heavy';
export type GlassLayer = 'base' | 'elevated' | 'floating';

export interface GlassConfig {
  intensity: GlassIntensity;
}

export const GLASS_PRESETS = {
  light:   { base: '4px',  elevated: '8px',  floating: '12px', opacityMultiplier: '1.2' },
  medium:  { base: '8px',  elevated: '16px', floating: '24px', opacityMultiplier: '1.0' },
  heavy:   { base: '16px', elevated: '24px', floating: '40px', opacityMultiplier: '0.6' },
  disabled:{ base: '0px',  elevated: '0px',  floating: '0px',  opacityMultiplier: '6.0' },
};
