// Local rendering check with synthetic assessment records. No account or app server needed.
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import bundler from "../verification/dashboard-ui/bundler.cjs";
const { build } = bundler;

const root = fileURLToPath(new URL("../", import.meta.url));
const output = await mkdtemp(path.join(tmpdir(), "dashboard-chart-check-"));
const fixture = `
import React from "react";
import { createRoot } from "react-dom/client";
import { DashboardChartPlot } from "./components/dashboard-chart-plot";
import { dashboardObservations, dashboardChartSelection, dashboardCohort } from "./lib/dashboard-filters";
import { assessmentValueKey } from "./lib/assessment-entry";
const rounds = ["Fall","Winter","Spring"].map(id => ({id, label:id, month:id}));
const sections = ["Regular","Irregular"].map(id => ({id, name:id, roundIds:rounds.map(r=>r.id)}));
const field = {id:"score", name:"Score", dataType:"float", sectionIds:sections.map(s=>s.id)};
const assessment = {id:"reading", name:"Reading", fields:[field], rounds, sections};
const years = Array.from({length:4},(_,i) => (2023+i)+"-"+(2024+i));
const row = {id:"fixture", student:"Fixture", assessmentValues:{}};
let n = 0;
for (const year of years) for(const round of rounds) for(const section of sections) {
  row.assessmentValues[assessmentValueKey(assessment,round,field,section,{schoolYear:year,grade:"3"})] = n++;
}
const cohort = dashboardCohort([row],years.map(schoolYear=>({studentId:row.id, schoolYear, grade:"3", homeroom:"A"})),years,[],{studentIds:[],homerooms:[],teamId:"all"});
const observations = dashboardObservations(years.map(year=>({assessment, year})),cohort,["reading::score"],[],"all",()=>[]);
const {chartData} = dashboardChartSelection(observations,null);
const props={chartData, chartSeries:observations.series,pieData:[{name:"Regular",value:11},{name:"Irregular",value:12}],scaleCodes:[],title:"Reading scores by section"};
const host=createRoot(document.getElementById("root"));
window.showPlot=(chartType,empty=false)=>host.render(<DashboardChartPlot {...props} chartType={chartType} chartData={empty?[]:props.chartData}/>);
window.showMissing=(sectioned)=>host.render(<DashboardChartPlot {...props} chartType="progression"
  chartSeries={[{id:"value", label:"Score", ...(sectioned?{sectionId:"Regular"}:{})}]}
  chartData={chartData.slice(0,3).map((p,i)=>({...p, value:[0,null,12][i]}))}/>);
window.showPlot("progression");
`;
const { outputFiles } = await build({
  absWorkingDir: root, stdin: { contents: fixture, loader: "tsx", resolveDir: root },
  define: { "process.env.NODE_ENV": '"production"' }, bundle: true, jsx: "automatic", write: false,
  outfile: "fixture.js", minify: true, logLevel: "silent"
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage({viewport:{width:1280,height:760}});
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("http://fixture.test/**", route => {
    const asset = outputFiles.find(f => route.request().url().endsWith(path.basename(f.path)));
    return route.fulfill(asset ? {body:Buffer.from(asset.contents),contentType:asset.path.endsWith(".css")?"text/css":"text/javascript"} :
      {contentType:"text/html",body:'<meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>'});
  });
  await page.goto("http://fixture.test/", {waitUntil:"domcontentloaded",timeout:90000});
  const region=page.getByRole("region"), svg=region.locator("svg.recharts-surface");
  const values=svg.locator("[data-point-value]");
  await expect(values).toHaveCount(24);
  assert.deepEqual((await values.allTextContents()).map(Number),Array.from({length:24},(_,i)=>i));
  await expect(svg.locator("[data-section-boundary]")).toHaveCount(21);
  await expect(svg.locator(".recharts-line-curve")).toHaveCount(2);
  for (const d of await svg.locator(".recharts-line-curve").evaluateAll(paths=>paths.map(p=>p.getAttribute("d"))))
    assert.equal((d.match(/L/g) ?? []).length,11);
  const bands=await svg.locator("[data-year-band] rect").evaluateAll(rects=>rects.map(r=>({x:+r.getAttribute("x"),w:+r.getAttribute("width")})));
  assert.equal(bands.length,4);
  for(let i=1;i<bands.length;i++) assert.ok(Math.abs(bands[i-1].x+bands[i-1].w-bands[i].x)<0.01);
  const yearTicks=svg.locator("[data-axis-tick]").filter({hasText:"2026-2027"});
  await expect(yearTicks.first().locator("tspan").last()).toHaveText("2026-2027");
  assert.ok(await region.evaluate(r=>r.clientWidth<=1000 && r.scrollWidth>r.clientWidth*2));
  await page.screenshot({path:path.join(output,"desktop.png")});
  await page.setViewportSize({width:390,height:740});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await region.evaluate(r=>r.scrollLeft=r.scrollWidth);
  assert.ok(await region.evaluate(r=>r.scrollLeft>1000));
  await page.screenshot({path:path.join(output,"mobile-right.png")});
  const download=page.waitForEvent("download");
  await page.getByRole("button",{name:"Download PDF"}).click();
  await (await download).saveAs(path.join(output,"chart.pdf"));
  for(const type of ["comparison","average"]) {
    await page.evaluate(t=>window.showPlot(t),type);
    await expect(svg.locator(type==="comparison"?".recharts-bar-rectangle":".recharts-pie-sector").first()).toBeVisible();
    if(type==="comparison") {
      await expect(svg.locator(".recharts-bar-rectangle")).toHaveCount(24);
      await expect(svg.locator(".recharts-label-list text").filter({hasText:/^0$/})).toHaveCount(1);
    }
    const dl=page.waitForEvent("download");
    await page.getByRole("button",{name:"Download PDF"}).click();
    await (await dl).saveAs(path.join(output,type+".pdf"));
  }
  await page.evaluate(()=>window.showPlot("progression",true));
  await expect(page.getByText("No values match the selected filters.")).toBeVisible();
  await expect(page.getByRole("button",{name:"Download PDF"})).toBeDisabled();
  for(const sectioned of [true,false]) {
    await page.evaluate(s=>window.showMissing(s),sectioned);
    await expect(values).toHaveCount(2);
    assert.deepEqual(await values.allTextContents(),["0","12"]);
    await expect(svg.locator(".recharts-line-dot")).toHaveCount(2);
    await expect(svg.locator(".recharts-line-curve")).toHaveAttribute("d",/^M[^M]+L[^M]+$/);
  }
  assert.deepEqual(errors,[]);
  console.log("Passed dashboard chart rendering, section integration, scroll and downloads:",output);
} finally { await browser.close(); }
