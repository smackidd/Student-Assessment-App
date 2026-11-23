const roomCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export const compareHomerooms = roomCollator.compare;
