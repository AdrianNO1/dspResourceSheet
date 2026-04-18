import { useState } from "react";

type ResourceIconProps = {
  name: string;
  iconUrl?: string | null;
  colorStart: string;
  colorEnd: string;
  size?: "sm" | "md" | "lg";
};

const sizeMap = {
  sm: 34,
  md: 46,
  lg: 58,
};

function buildMonogram(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function ResourceIcon({ name, iconUrl, colorStart, colorEnd, size = "md" }: ResourceIconProps) {
  const [failed, setFailed] = useState(false);
  const dimension = sizeMap[size];

  return (
    <span
      className="resource-icon"
      style={{
        width: dimension,
        height: dimension,
        background: `linear-gradient(135deg, ${colorStart}, ${colorEnd})`,
      }}
      aria-hidden="true"
    >
      {iconUrl && !failed ? (
        <img src={iconUrl} alt="" onError={() => setFailed(true)} />
      ) : (
        <span>{buildMonogram(name)}</span>
      )}
    </span>
  );
}
