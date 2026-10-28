import type { ComponentPropsWithoutRef } from "react";

type BrandLogoProps = Omit<ComponentPropsWithoutRef<"img">, "alt" | "src"> & {
  alt?: string;
};

/** Full horizontal OmniTeam brand logo with dark mode switching */
export function BrandLogo({
  alt = "OmniTeam",
  className = "h-10 w-auto object-contain",
  ...props
}: BrandLogoProps) {
  return (
    <>
      <img
        src="/omniteam-logo.png"
        alt={alt}
        className={`dark:hidden select-none ${className}`}
        draggable={false}
        {...props}
      />
      <img
        src="/omniteam-logo-dark.png"
        alt={alt}
        className={`hidden dark:block select-none ${className}`}
        draggable={false}
        {...props}
      />
    </>
  );
}
