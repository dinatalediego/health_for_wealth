import type { KitchenState } from "./types";

export const demoState: KitchenState = {
  locations: [
    { id: "fridge", name: "Refrigeradora", type: "fridge" },
    { id: "freezer", name: "Freezer", type: "freezer" },
    { id: "pantry", name: "Despensa", type: "pantry" },
    { id: "organizer", name: "Organizadores", type: "organizer" }
  ],
  items: [
    { id:"eggs",name:"Huevos",emoji:"🥚",category:"Proteína",unit:"unidad",quantity:8,min:6,ideal:12,locationId:"fridge",locationName:"Refrigeradora",locationType:"fridge" },
    { id:"oats",name:"Avena",emoji:"🌾",category:"Cereales",unit:"g",quantity:520,min:250,ideal:750,locationId:"pantry",locationName:"Despensa",locationType:"pantry" },
    { id:"milk",name:"Leche",emoji:"🥛",category:"Lácteos",unit:"ml",quantity:1100,min:500,ideal:2000,locationId:"fridge",locationName:"Refrigeradora",locationType:"fridge" },
    { id:"banana",name:"Plátano",emoji:"🍌",category:"Frutas",unit:"unidad",quantity:5,min:3,ideal:8,locationId:"organizer",locationName:"Organizadores",locationType:"organizer" },
    { id:"apple",name:"Manzana",emoji:"🍎",category:"Frutas",unit:"unidad",quantity:4,min:3,ideal:8,locationId:"organizer",locationName:"Organizadores",locationType:"organizer" },
    { id:"yogurt",name:"Yogur griego",emoji:"🥣",category:"Lácteos",unit:"unidad",quantity:4,min:3,ideal:8,locationId:"fridge",locationName:"Refrigeradora",locationType:"fridge" },
    { id:"chicken",name:"Pollo",emoji:"🍗",category:"Proteína",unit:"g",quantity:720,min:400,ideal:1400,locationId:"freezer",locationName:"Freezer",locationType:"freezer" },
    { id:"rice",name:"Arroz",emoji:"🍚",category:"Cereales",unit:"g",quantity:900,min:400,ideal:1500,locationId:"pantry",locationName:"Despensa",locationType:"pantry" },
    { id:"veg",name:"Verduras mixtas",emoji:"🥦",category:"Verduras",unit:"g",quantity:700,min:400,ideal:1200,locationId:"freezer",locationName:"Freezer",locationType:"freezer" },
    { id:"tomato",name:"Tomate",emoji:"🍅",category:"Verduras",unit:"unidad",quantity:5,min:3,ideal:8,locationId:"fridge",locationName:"Refrigeradora",locationType:"fridge" },
    { id:"avocado",name:"Palta",emoji:"🥑",category:"Grasas saludables",unit:"unidad",quantity:2,min:2,ideal:5,locationId:"organizer",locationName:"Organizadores",locationType:"organizer" },
    { id:"bread",name:"Pan integral",emoji:"🍞",category:"Cereales",unit:"rebanada",quantity:10,min:6,ideal:20,locationId:"pantry",locationName:"Despensa",locationType:"pantry" },
    { id:"tuna",name:"Atún",emoji:"🐟",category:"Proteína",unit:"lata",quantity:2,min:2,ideal:6,locationId:"pantry",locationName:"Despensa",locationType:"pantry" },
    { id:"nuts",name:"Frutos secos",emoji:"🥜",category:"Grasas saludables",unit:"g",quantity:170,min:120,ideal:400,locationId:"pantry",locationName:"Despensa",locationType:"pantry" }
  ],
  meals: [
    { id:"m1",name:"Avena power",emoji:"🥣",type:"breakfast",prepMinutes:7,ingredients:[{productId:"oats",quantity:60,unit:"g"},{productId:"milk",quantity:250,unit:"ml"},{productId:"banana",quantity:1,unit:"unidad"}] },
    { id:"m2",name:"Huevos con palta",emoji:"🍳",type:"breakfast",prepMinutes:10,ingredients:[{productId:"eggs",quantity:2,unit:"unidad"},{productId:"avocado",quantity:.5,unit:"unidad"},{productId:"bread",quantity:2,unit:"rebanada"}] },
    { id:"m3",name:"Pollo, arroz y verduras",emoji:"🍲",type:"lunch",prepMinutes:22,ingredients:[{productId:"chicken",quantity:180,unit:"g"},{productId:"rice",quantity:100,unit:"g"},{productId:"veg",quantity:200,unit:"g"}] },
    { id:"m4",name:"Atún, arroz y tomate",emoji:"🥗",type:"lunch",prepMinutes:12,ingredients:[{productId:"tuna",quantity:1,unit:"lata"},{productId:"rice",quantity:100,unit:"g"},{productId:"tomato",quantity:1,unit:"unidad"}] },
    { id:"m5",name:"Omelette de verduras",emoji:"🍳",type:"dinner",prepMinutes:12,ingredients:[{productId:"eggs",quantity:3,unit:"unidad"},{productId:"veg",quantity:150,unit:"g"},{productId:"tomato",quantity:1,unit:"unidad"}] },
    { id:"m6",name:"Pollo con palta y tomate",emoji:"🥙",type:"dinner",prepMinutes:15,ingredients:[{productId:"chicken",quantity:160,unit:"g"},{productId:"avocado",quantity:.5,unit:"unidad"},{productId:"tomato",quantity:1,unit:"unidad"}] },
    { id:"m7",name:"Yogur con plátano",emoji:"🍌",type:"snack",prepMinutes:3,ingredients:[{productId:"yogurt",quantity:1,unit:"unidad"},{productId:"banana",quantity:1,unit:"unidad"}] },
    { id:"m8",name:"Manzana con frutos secos",emoji:"🍎",type:"snack",prepMinutes:2,ingredients:[{productId:"apple",quantity:1,unit:"unidad"},{productId:"nuts",quantity:30,unit:"g"}] }
  ],
  events: [],
  mealEvents: []
};
