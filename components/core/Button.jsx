import React from "react";

const SIZES = {
  // sm/md reach the Android touch floor (44px); never below it (A2 audit).
  sm: { fontSize: "var(--text-sm)", padding: "10px 16px", height: 44, radius: "var(--radius-sm)", gap: 6 },
  md: { fontSize: "var(--text-base)", padding: "11px 20px", height: 44, radius: "var(--radius-md)", gap: 8 },
  lg: { fontSize: "var(--text-md)", padding: "14px 26px", height: 54, radius: "var(--radius-md)", gap: 10 },
};

function variantStyle(variant) {
  switch (variant) {
    case "secondary":
      return { background: "var(--surface-card)", color: "var(--text-strong)", border: "1px solid var(--border-default)", boxShadow: "var(--shadow-xs)" };
    case "ghost":
      return { background: "transparent", color: "var(--brand)", border: "1px solid transparent" };
    case "mint":
      return { background: "var(--accent)", color: "#06241B", border: "1px solid transparent", boxShadow: "var(--shadow-mint)" };
    case "inverse":
      return { background: "var(--surface-inverse)", color: "var(--text-on-inverse)", border: "1px solid transparent" };
    case "primary":
    default:
      return { background: "var(--brand)", color: "var(--text-on-brand)", border: "1px solid transparent", boxShadow: "var(--shadow-brand)" };
  }
}

/**
 * Gorgon primary action button. Chinese-first label, optional leading/trailing icon.
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  block = false,
  disabled = false,
  leadingIcon = null,
  trailingIcon = null,
  style = {},
  ...rest
}) {
  const s = SIZES[size] || SIZES.md;
  const v = variantStyle(variant);
  return (
    <button
      disabled={disabled}
      style={{
        display: block ? "flex" : "inline-flex",
        width: block ? "100%" : "auto",
        alignItems: "center",
        justifyContent: "center",
        gap: s.gap,
        fontFamily: "var(--font-sans)",
        fontWeight: "var(--weight-semibold)",
        fontSize: s.fontSize,
        lineHeight: 1,
        minHeight: s.height,
        padding: s.padding,
        borderRadius: s.radius,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: "transform var(--dur-fast) var(--ease-out), filter var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out)",
        whiteSpace: "nowrap",
        // Touch: removes the 300ms tap delay and stops scroll-gesture hijacking.
        touchAction: "manipulation",
        ...v,
        ...style,
      }}
      onPointerDown={(e) => { if (!disabled) e.currentTarget.style.transform = "scale(0.97)"; }}
      onPointerUp={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      onPointerCancel={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      onPointerLeave={(e) => { e.currentTarget.style.transform = "scale(1)"; }}
      {...rest}
    >
      {leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
}
