"use client";

import { useEffect, useMemo, useState } from "react";
import { coverageDays, itemStatus, mealCounts, mealTypeLabel, mealsUnlockedByRestock, restockSuggestions, servingsForMeal, stockHealth } from "@/lib/engine";
import { demoState } from "@/lib/demo";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import type { Item, KitchenState, LocationType, Meal, MealType } from "@/lib/types";

type Tab = "home" | "stock" | "meals" | "shopping" | "reporting";
const STORAGE_KEY = "health_for_wealth_kitchen_v0";

const cloneDemo = () => JSON.parse(JSON.stringify(demoState)) as KitchenState;
const nowIso = () => new Date().toISOString();

export function KitchenApp() {
  const [state,setState] = useState<KitchenState>(cloneDemo());
  const [tab,setTab] = useState<Tab>("home");
  const [busy,setBusy] = useState(false);
  const [cloud,setCloud] = useState(false);
  const [sessionReady,setSessionReady] = useState(false);
  const [session,setSession] = useState<any>(null);
  const [localOverride,setLocalOverride] = useState(false);
  const [toast,setToast] = useState("");
  const [stockFilter,setStockFilter] = useState<LocationType | "all">("all");
  const [mealFilter,setMealFilter] = useState<MealType | "all">("all");

  const supabase = getSupabase();

  useEffect(()=>{
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try { setState(JSON.parse(saved)); } catch {}
    }
  },[]);

  useEffect(()=>{
    if (!supabase || localOverride) { setSessionReady(true); setCloud(false); return; }
    supabase.auth.getSession().then(({data})=>{ setSession(data.session); setSessionReady(true); });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_e,s)=>{ setSession(s); });
    return ()=>subscription.unsubscribe();
  },[supabase,localOverride]);

  useEffect(()=>{
    if (session && supabase && !localOverride) {
      setCloud(true);
      bootstrapAndLoad();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[session,localOverride]);

  useEffect(()=>{
    if (!cloud) localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
  },[state,cloud]);

  const metrics = useMemo(()=>({
    coverage:coverageDays(state),
    counts:mealCounts(state),
    health:stockHealth(state),
    restock:restockSuggestions(state)
  }),[state]);

  async function bootstrapAndLoad() {
    if (!supabase) return;
    setBusy(true);
    const {data:householdId,error:bootError} = await supabase.rpc("hfw_bootstrap");
    if (bootError) { flash(bootError.message); setBusy(false); return; }
    const [inv,locs,meals,ings,events,mealEvents] = await Promise.all([
      supabase.from("hfw_inventory_state").select("*"),
      supabase.from("hfw_locations").select("*").order("sort_order"),
      supabase.from("hfw_meal_availability").select("*"),
      supabase.from("hfw_meal_ingredients").select("*"),
      supabase.from("hfw_inventory_events").select("*").order("occurred_at",{ascending:false}).limit(120),
      supabase.from("hfw_meal_events").select("*").order("occurred_at",{ascending:false}).limit(120)
    ]);
    const items: Item[] = (inv.data ?? []).map((r:any)=>({
      id:r.product_id,householdId:r.household_id,name:r.name,emoji:r.emoji,category:r.category,unit:r.unit,
      quantity:Number(r.quantity),min:Number(r.min_stock),ideal:Number(r.ideal_stock),
      locationId:r.location_id,locationName:r.location_name,locationType:r.location_type,nextExpiry:r.next_expiry
    }));
    const mealRows = meals.data ?? [];
    const ingredients = ings.data ?? [];
    const mealList: Meal[] = mealRows.map((m:any)=>({
      id:m.meal_id,name:m.name,emoji:m.emoji,type:m.meal_type,prepMinutes:m.prep_minutes,
      ingredients:ingredients.filter((i:any)=>i.meal_id===m.meal_id).map((i:any)=>({
        productId:i.product_id,quantity:Number(i.quantity_per_serving),unit:i.unit,optional:i.optional
      }))
    }));
    setState({
      householdId,
      locations:(locs.data ?? []).map((l:any)=>({id:l.id,name:l.name,type:l.type})),
      items,meals:mealList,
      events:(events.data ?? []).map((e:any)=>({id:e.id,productId:e.product_id,type:e.event_type,delta:Number(e.quantity_delta),unit:e.unit,occurredAt:e.occurred_at,reason:e.reason})),
      mealEvents:(mealEvents.data ?? []).map((e:any)=>({id:e.id,mealId:e.meal_id,servings:e.servings,occurredAt:e.occurred_at}))
    });
    setBusy(false);
  }

  function flash(message:string) {
    setToast(message);
    window.setTimeout(()=>setToast(""),2600);
  }

  async function setQuantity(item:Item, quantity:number) {
    const q = Math.max(0, Number.isFinite(quantity) ? quantity : 0);
    if (cloud && supabase) {
      setBusy(true);
      const {error} = await supabase.rpc("hfw_set_stock",{p_product_id:item.id,p_quantity:q,p_location_id:item.locationId});
      if (error) flash(error.message); else await bootstrapAndLoad();
      setBusy(false);
      return;
    }
    const delta=q-item.quantity;
    setState(s=>({...s,items:s.items.map(i=>i.id===item.id?{...i,quantity:q}:i),
      events:delta===0?s.events:[{id:crypto.randomUUID(),productId:item.id,type:delta>0?"adjust":"consume",delta,unit:item.unit,occurredAt:nowIso(),reason:"quick_update"},...s.events]
    }));
  }

  async function updateTargets(item:Item, min:number, ideal:number) {
    min=Math.max(0,min); ideal=Math.max(min,ideal);
    if (cloud && supabase) {
      const {error}=await supabase.from("hfw_products").update({min_stock:min,ideal_stock:ideal}).eq("id",item.id);
      if (error) flash(error.message); else await bootstrapAndLoad();
      return;
    }
    setState(s=>({...s,items:s.items.map(i=>i.id===item.id?{...i,min,ideal}:i)}));
  }

  async function consumeMeal(meal:Meal) {
    const available=servingsForMeal(meal,state.items);
    if (available<1) return flash("Faltan ingredientes para esta comida.");
    if (cloud && supabase) {
      setBusy(true);
      const {error}=await supabase.rpc("hfw_consume_meal",{p_meal_id:meal.id,p_servings:1});
      if (error) flash(error.message); else { flash("Comida registrada ✓"); await bootstrapAndLoad(); }
      setBusy(false);
      return;
    }
    const req=new Map(meal.ingredients.filter(x=>!x.optional).map(x=>[x.productId,x]));
    setState(s=>({
      ...s,
      items:s.items.map(i=>req.has(i.id)?{...i,quantity:Math.max(0,i.quantity-(req.get(i.id)?.quantity??0))}:i),
      events:[
        ...meal.ingredients.filter(x=>!x.optional).map(x=>({id:crypto.randomUUID(),productId:x.productId,type:"consume" as const,delta:-x.quantity,unit:x.unit,occurredAt:nowIso(),reason:`meal:${meal.name}`})),
        ...s.events
      ],
      mealEvents:[{id:crypto.randomUUID(),mealId:meal.id,servings:1,occurredAt:nowIso()},...s.mealEvents]
    }));
    flash("Comida registrada ✓");
  }

  async function restock(item:Item, amount:number) {
    await setQuantity(item,item.quantity+amount);
    flash(`${item.name}: stock repuesto ✓`);
  }

  if (!sessionReady) return <main className="shell loading">Preparando tu cocina…</main>;
  if (isSupabaseConfigured() && !session && !localOverride) return <CloudLogin onLocal={()=>setLocalOverride(true)} />;
  
  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">HEALTH FOR WEALTH</div>
          <h1>Kitchen Readiness</h1>
        </div>
        <div className={`sync-pill ${cloud?"cloud":""}`}>{cloud?"☁️ Supabase":"📱 Local"}</div>
      </header>

      {tab==="home" && <Home state={state} metrics={metrics} go={setTab} />}
      {tab==="stock" && <Stock state={state} filter={stockFilter} setFilter={setStockFilter} setQuantity={setQuantity} updateTargets={updateTargets} />}
      {tab==="meals" && <Meals state={state} filter={mealFilter} setFilter={setMealFilter} consume={consumeMeal} />}
      {tab==="shopping" && <Shopping state={state} restock={restock} />}
      {tab==="reporting" && <Reporting state={state} />}

      <nav className="bottom-nav">
        <NavButton active={tab==="home"} icon="⌂" label="Inicio" onClick={()=>setTab("home")} />
        <NavButton active={tab==="stock"} icon="▦" label="Stock" onClick={()=>setTab("stock")} />
        <NavButton active={tab==="meals"} icon="🍽" label="Meals" onClick={()=>setTab("meals")} />
        <NavButton active={tab==="shopping"} icon="🛒" label="Comprar" onClick={()=>setTab("shopping")} />
        <NavButton active={tab==="reporting"} icon="↗" label="Reportes" onClick={()=>setTab("reporting")} />
      </nav>

      {busy && <div className="busy">Sincronizando…</div>}
      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}

function CloudLogin({onLocal}:{onLocal:()=>void}) {
  const [email,setEmail]=useState("");
  const [msg,setMsg]=useState("");
  const supabase=getSupabase();
  async function emailLogin() {
    if (!supabase || !email) return;
    const {error}=await supabase.auth.signInWithOtp({email,options:{emailRedirectTo:window.location.origin}});
    setMsg(error?error.message:"Revisa tu correo: te enviamos el acceso.");
  }
  async function google() {
    if (!supabase) return;
    const {error}=await supabase.auth.signInWithOAuth({provider:"google",options:{redirectTo:window.location.origin}});
    if(error)setMsg(error.message);
  }
  return <main className="login-page">
    <section className="login-card">
      <div className="brand-orb">🥑</div>
      <div className="eyebrow">HEALTH FOR WEALTH</div>
      <h1>Tu cocina lista antes de que tengas hambre.</h1>
      <p>Stock → comidas posibles → días cubiertos → compra inteligente.</p>
      <button className="primary full" onClick={google}>Continuar con Google</button>
      <div className="or">o</div>
      <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@email.com" type="email" />
      <button className="secondary full" onClick={emailLogin}>Enviar link de acceso</button>
      <button className="text-button" onClick={onLocal}>Probar primero en modo local</button>
      {msg && <small>{msg}</small>}
    </section>
  </main>
}

function Home({state,metrics,go}:{state:KitchenState;metrics:any;go:(t:Tab)=>void}) {
  const attention=state.items.filter(i=>itemStatus(i)!=="OK").slice(0,4);
  return <section className="page">
    <div className="hero">
      <div>
        <div className="eyebrow light">HOME MEAL COVERAGE</div>
        <div className="coverage"><strong>{metrics.coverage}</strong><span>días</span></div>
        <p>con desayuno, almuerzo, cena y snack disponibles.</p>
      </div>
      <div className="health-ring" style={{"--health":`${metrics.health*3.6}deg`} as any}>
        <span>{metrics.health}%</span><small>stock sano</small>
      </div>
    </div>

    <div className="meal-strip">
      {(["breakfast","lunch","dinner","snack"] as MealType[]).map(t=><div key={t}><span>{({breakfast:"🥣",lunch:"🍲",dinner:"🌙",snack:"🍎"} as any)[t]}</span><strong>{metrics.counts[t]}</strong><small>{mealTypeLabel(t)}</small></div>)}
    </div>

    <div className="section-head"><div><div className="eyebrow">YOUR KITCHEN</div><h2>¿Dónde está?</h2></div><button onClick={()=>go("stock")}>Ver stock</button></div>
    <div className="storage-grid">
      <StorageCard type="fridge" title="Refrigeradora" icon="❄️" state={state}/>
      <StorageCard type="freezer" title="Freezer" icon="🧊" state={state}/>
      <StorageCard type="pantry" title="Despensa" icon="🥫" state={state}/>
      <StorageCard type="organizer" title="Organizadores" icon="🧺" state={state}/>
    </div>

    <div className="action-grid">
      <button className="action-card eat" onClick={()=>go("meals")}><span>🍽️</span><div><strong>¿Qué puedo comer?</strong><small>Solo opciones posibles ahora</small></div><b>→</b></button>
      <button className="action-card buy" onClick={()=>go("shopping")}><span>🛒</span><div><strong>Smart Restock</strong><small>{metrics.restock.length} cosas necesitan atención</small></div><b>→</b></button>
    </div>

    <div className="section-head"><div><div className="eyebrow">ATTENTION</div><h2>Lo importante ahora</h2></div></div>
    <div className="attention-list">
      {attention.length===0 && <div className="empty">Todo bien. No necesitas pensar en compras ahora. ✓</div>}
      {attention.map(i=><div className="attention" key={i.id}><span>{i.emoji}</span><div><strong>{i.name}</strong><small>{i.quantity} {i.unit} · mínimo {i.min}</small></div><em>{itemStatus(i)==="OUT"?"Agotado":"Bajo"}</em></div>)}
    </div>
  </section>
}

function StorageCard({type,title,icon,state}:{type:LocationType;title:string;icon:string;state:KitchenState}) {
  const items=state.items.filter(i=>i.locationType===type);
  const stocked=items.filter(i=>i.quantity>0).length;
  const pct=items.length?Math.round(stocked/items.length*100):0;
  return <div className={`storage-card ${type}`}>
    <div className="storage-top"><span>{icon}</span><em>{pct}%</em></div>
    <h3>{title}</h3><p>{stocked} de {items.length} básicos con stock</p>
    <div className="shelf"><i></i><i></i><i></i></div>
  </div>
}

function Stock({state,filter,setFilter,setQuantity,updateTargets}:{state:KitchenState;filter:any;setFilter:any;setQuantity:any;updateTargets:any}) {
  const items=filter==="all"?state.items:state.items.filter(i=>i.locationType===filter);
  return <section className="page">
    <div className="page-title"><div className="eyebrow">INVENTORY</div><h2>Tu cocina, sin Excel.</h2><p>Toca − / + o escribe la cantidad real. Min e ideal controlan las alertas y compras.</p></div>
    <div className="chips">
      {[["all","Todo"],["fridge","Refrigeradora"],["freezer","Freezer"],["pantry","Despensa"],["organizer","Organizadores"]].map(([v,l])=><button className={filter===v?"active":""} key={v} onClick={()=>setFilter(v)}>{l}</button>)}
    </div>
    <div className="inventory-list">
      {items.map(item=><div className="inventory-card" key={item.id}>
        <div className="food-icon">{item.emoji}</div>
        <div className="inventory-main"><div className="inventory-title"><strong>{item.name}</strong><span className={itemStatus(item).toLowerCase()}>{itemStatus(item)}</span></div>
          <small>{item.locationName} · {item.category}</small>
          <div className="stock-progress"><i style={{width:`${Math.min(100,item.ideal?item.quantity/item.ideal*100:0)}%`}} /></div>
          <div className="targets">
            <label>mín <input defaultValue={item.min} onBlur={e=>updateTargets(item,Number(e.target.value),item.ideal)} /></label>
            <label>ideal <input defaultValue={item.ideal} onBlur={e=>updateTargets(item,item.min,Number(e.target.value))} /></label>
          </div>
        </div>
        <div className="stepper">
          <button onClick={()=>setQuantity(item,item.quantity-1)}>−</button>
          <input value={item.quantity} onChange={e=>setQuantity(item,Number(e.target.value))} />
          <button onClick={()=>setQuantity(item,item.quantity+1)}>+</button>
          <small>{item.unit}</small>
        </div>
      </div>)}
    </div>
  </section>
}

function Meals({state,filter,setFilter,consume}:{state:KitchenState;filter:any;setFilter:any;consume:any}) {
  const meals=(filter==="all"?state.meals:state.meals.filter(m=>m.type===filter))
    .map(m=>({m,servings:servingsForMeal(m,state.items)}))
    .sort((a,b)=>b.servings-a.servings);
  return <section className="page">
    <div className="page-title"><div className="eyebrow">MEAL ENGINE</div><h2>¿Qué puedo comer ahora?</h2><p>Solo muestra combinaciones que tu stock puede producir.</p></div>
    <div className="chips">{[["all","Todas"],["breakfast","Desayuno"],["lunch","Almuerzo"],["dinner","Cena"],["snack","Snack"]].map(([v,l])=><button className={filter===v?"active":""} key={v} onClick={()=>setFilter(v)}>{l}</button>)}</div>
    <div className="meal-grid">
      {meals.map(({m,servings})=><article className={`meal-card ${servings===0?"disabled":""}`} key={m.id}>
        <div className="meal-icon">{m.emoji}</div>
        <div className="meal-copy"><small>{mealTypeLabel(m.type)} · {m.prepMinutes} min</small><h3>{m.name}</h3>
          <p>{m.ingredients.filter(x=>!x.optional).map(x=>state.items.find(i=>i.id===x.productId)?.name).filter(Boolean).join(" · ")}</p>
        </div>
        <div className="meal-availability"><strong>{servings}</strong><span>porciones</span></div>
        <button disabled={servings<1} onClick={()=>consume(m)}>{servings?"✓ Comí esto":"Faltan ingredientes"}</button>
      </article>)}
    </div>
  </section>
}

function Shopping({state,restock}:{state:KitchenState;restock:any}) {
  const suggestions=restockSuggestions(state);
  return <section className="page">
    <div className="page-title"><div className="eyebrow">SMART RESTOCK</div><h2>Compra lo que desbloquea comidas.</h2><p>Prioriza continuidad, no una lista infinita de supermercado.</p></div>
    <div className="restock-summary"><strong>{suggestions.length}</strong><span>items para recuperar tu stock ideal</span></div>
    <div className="shopping-list">
      {suggestions.length===0 && <div className="empty">Tu cocina ya está sobre los mínimos. No compres por inercia. ✓</div>}
      {suggestions.map(i=><div className="shopping-row" key={i.id}>
        <span className="food-icon small">{i.emoji}</span>
        <div><strong>{i.name}</strong><small>Comprar {i.suggested} {i.unit} · {mealsUnlockedByRestock(state,i.id)} meals potenciales desbloqueadas</small></div>
        <button onClick={()=>restock(i,i.suggested)}>Comprado</button>
      </div>)}
    </div>
  </section>
}

function Reporting({state}:{state:KitchenState}) {
  const counts=mealCounts(state), coverage=coverageDays(state), health=stockHealth(state);
  const weekAgo=Date.now()-7*86400000;
  const mealWeek=state.mealEvents.filter(e=>new Date(e.occurredAt).getTime()>=weekAgo).reduce((s,e)=>s+e.servings,0);
  const wasteWeek=state.events.filter(e=>e.type==="waste"&&new Date(e.occurredAt).getTime()>=weekAgo).length;
  const out=state.items.filter(i=>i.quantity<=0).length;
  const max=Math.max(...Object.values(counts),1);
  return <section className="page reporting">
    <div className="page-title"><div className="eyebrow">REPORTING</div><h2>¿Tu cocina te está cuidando?</h2><p>Métricas para continuidad, hábitos y menos decisiones improvisadas afuera.</p></div>
    <div className="kpi-grid">
      <Kpi big={coverage} label="días cubiertos" note="North Star"/>
      <Kpi big={`${health}%`} label="stock saludable" note="sobre mínimos"/>
      <Kpi big={mealWeek} label="meals registradas" note="últimos 7 días"/>
      <Kpi big={out} label="stockouts" note="ahora"/>
    </div>
    <div className="report-grid">
      <article className="chart-card"><div className="eyebrow">MEAL CAPACITY</div><h3>Comidas disponibles</h3>
        <div className="bars">{(["breakfast","lunch","dinner","snack"] as MealType[]).map(t=><div className="bar-row" key={t}><span>{mealTypeLabel(t)}</span><div><i style={{width:`${counts[t]/max*100}%`}} /></div><strong>{counts[t]}</strong></div>)}</div>
      </article>
      <article className="chart-card"><div className="eyebrow">STOCK HEALTH</div><h3>Composición actual</h3>
        <div className="donut" style={{"--p":`${health*3.6}deg`} as any}><span>{health}%</span></div>
        <p>{state.items.filter(i=>itemStatus(i)==="OK").length} OK · {state.items.filter(i=>itemStatus(i)==="LOW").length} bajos · {out} agotados</p>
      </article>
    </div>
    <article className="chart-card"><div className="eyebrow">BEHAVIOR LOOP</div><h3>Actividad reciente</h3>
      <div className="timeline">
        {state.events.slice(0,8).map(e=>{const item=state.items.find(i=>i.id===e.productId);return <div key={e.id}><span>{e.delta<0?"−":"+"}</span><p><strong>{item?.name??"Item"}</strong><small>{e.delta} {e.unit} · {new Date(e.occurredAt).toLocaleDateString("es-PE")}</small></p></div>})}
        {!state.events.length && <div className="empty">Todavía no hay eventos. Tus actualizaciones empezarán a construir el historial.</div>}
      </div>
    </article>
    <div className="footnote">Desperdicio registrado esta semana: <strong>{wasteWeek}</strong>. En siguientes versiones se añadirá gasto evitado y costo por meal con datos reales, no estimaciones inventadas.</div>
  </section>
}

function Kpi({big,label,note}:{big:any;label:string;note:string}) { return <div className="kpi"><small>{note}</small><strong>{big}</strong><span>{label}</span></div>; }
function NavButton({active,icon,label,onClick}:{active:boolean;icon:string;label:string;onClick:()=>void}) { return <button className={active?"active":""} onClick={onClick}><span>{icon}</span><small>{label}</small></button>; }
