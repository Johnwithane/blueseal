export interface TradeOption {
  key: string;
  label: string;
  icon: string; // PrimeIcons name
}

export const TRADES: TradeOption[] = [
  { key: "plumber", label: "Plumber", icon: "pi pi-bolt" },
  { key: "electrician", label: "Electrician", icon: "pi pi-flash" },
  { key: "hvac", label: "HVAC Tech", icon: "pi pi-sun" },
  { key: "carpenter", label: "Carpenter", icon: "pi pi-wrench" },
  { key: "painter", label: "Painter", icon: "pi pi-palette" },
  { key: "roofer", label: "Roofer", icon: "pi pi-home" },
  { key: "landscaper", label: "Landscaper", icon: "pi pi-globe" },
  { key: "handyman", label: "Handyman", icon: "pi pi-cog" },
  { key: "appliance_repair", label: "Appliance Repair", icon: "pi pi-desktop" },
  { key: "drywall", label: "Drywall", icon: "pi pi-th-large" },
  { key: "flooring", label: "Flooring", icon: "pi pi-table" },
  { key: "tiling", label: "Tiling", icon: "pi pi-stop" },
  { key: "locksmith", label: "Locksmith", icon: "pi pi-lock" },
  { key: "pest_control", label: "Pest Control", icon: "pi pi-shield" },
  { key: "cleaning", label: "Cleaning", icon: "pi pi-sparkles" },
];

export function tradeLabel(key: string): string {
  return TRADES.find((t) => t.key === key)?.label ?? key;
}
