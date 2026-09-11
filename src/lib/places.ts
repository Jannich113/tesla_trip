export type Geo = { lat: number; lng: number; short: string };

export const PLACES: Record<string, Geo> = {
  Home: { lat: 37.3852, lng: -122.1141, short: "Home" },
  "Work · Mountain View": { lat: 37.3946, lng: -122.0788, short: "Work" },
  "Whole Foods, Los Altos": { lat: 37.4016, lng: -122.1144, short: "Whole Foods" },
  "Stanford Dish": { lat: 37.4086, lng: -122.1601, short: "Dish" },
  "Costco, Mountain View": { lat: 37.4147, lng: -122.0786, short: "Costco" },
  "Palo Alto": { lat: 37.4451, lng: -122.1607, short: "Palo Alto" },
  "Half Moon Bay": { lat: 37.4636, lng: -122.4286, short: "Half Moon Bay" },
  "SF Embarcadero": { lat: 37.7955, lng: -122.3937, short: "Embarcadero" },
  "Santa Cruz": { lat: 36.9741, lng: -122.0308, short: "Santa Cruz" },
  "Gilroy Outlets": { lat: 37.0255, lng: -121.5658, short: "Gilroy" },
  "Muir Woods": { lat: 37.8914, lng: -122.5811, short: "Muir Woods" },
  Napa: { lat: 38.2975, lng: -122.2869, short: "Napa" },
  "Home Wall Connector": { lat: 37.3852, lng: -122.1141, short: "Home" },
  "San Jose Supercharger": { lat: 37.3318, lng: -121.8906, short: "San Jose" },
  "Gilroy Supercharger": { lat: 37.0142, lng: -121.5574, short: "Gilroy" },
  "Santa Cruz Supercharger": { lat: 36.9749, lng: -122.0263, short: "Santa Cruz" },
  "San Francisco Supercharger": { lat: 37.7841, lng: -122.4075, short: "San Francisco" },
  "Napa Supercharger": { lat: 38.2991, lng: -122.2852, short: "Napa" },
};

export function geo(name: string): Geo | undefined {
  return PLACES[name];
}
