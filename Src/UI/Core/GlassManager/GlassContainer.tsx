import React from 'react';
import { glassVariants } from './variants';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface GlassContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  layer?: 'base' | 'elevated' | 'floating';
  interactive?: boolean;
}

export const GlassContainer = React.forwardRef<HTMLDivElement, GlassContainerProps>(
  ({ className, layer, interactive, ...props }, ref) => {
    return (
      <div 
        ref={ref}
        className={cn(glassVariants({ layer, interactive }), className)} 
        {...props} 
      />
    );
  }
);
GlassContainer.displayName = 'GlassContainer';
