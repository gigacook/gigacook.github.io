# Stämmer motorn med tentan? — kort verdikt + vad jag ändrade

Du bad mig kolla två saker. Här är svaret rakt upp och ner.

## 1) Är `autismfinal`-motorn i linje med simtentan?

**Delvis. Den tränar ungefär halva tentan — den svåra halvan, men inte hela.**

Jag läste de tre sammanställningarna (HT25, VT25-munta, prep-kompendiet) och kartlade hur tentan
faktiskt går till. Varje station är ett **iscensatt OSCE-flöde**:

> roll/blurb → **anamnes** (du frågar, patienten/dockan svarar) → **status** (du *utför/förklarar*
> tekniken och namnger anatomi) → **prover** → **handläggning** → **utredning** (+ hur skyndsamt)
> → **patientinfo** (bemötandet betygsätts) → **SBAR** (fokus på R, kort) → **följdfrågor**
> (examinatorn grillar: anatomi, diffar, mekanismer, klassifikationer, läkemedel, prognos) → **feedback**.

`autismfinal` är byggd som `STATE → FRÅGA → FOLLOWUP → TAIL`. Det fångar **kliniskt resonemang,
följdfråge-grillningen och komplikationspressen mycket bra** — det är dess styrka, och det är en
stor del av poängen i följdfråge-delen. Men den **plattar ut faserna** och tränar därför *inte*:

- **Anamnes-tagandet** (att aktivt fråga, och tappa poäng när du glömmer vitalparametrar, socialt, tetanus…)
- **Status-demonstrationen** (tyreoideastatus + landmärken, handstatus FDP/FDS/2PD, kärlstatus 5P/ABI, ABCDE, fotstatus) — examineras *hårt*
- **SBAR-leveransen** (krävs i nästan varje fall, R i fokus)
- **Bemötandet** mot patient och kollega (uttalat betygssatt)

Kort sagt: kör du bara `autismfinal` övar du resonemang och diffar — inte själva stationsflödet.

## 2) Vad jag gjorde åt det

Byggde en **ny, riktad version** som speglar det riktiga stationsflödet, parsad ur *dina egna* fall:

- **`cases_simtenta.json`** — 25 riktiga, rapporterade fall (22 HIGH-yield), strukturerade i de verkliga
  faserna ovan. Alla 10 specialiteter: kirurgi, anestesi, ortopedi, radiologi, onkologi, urologi,
  plastik, hand, kärl, endokrin. Inkl. fällorna folk gick på (drick *mindre* vatten vid njursten,
  ring *neurolog* inte kärl vid armsvaghet, *reponera bråcket på akuten*, distalstatus *före* bedövning…).
- **`simtenta_spel.html`** — ett spel du trycker igenom en fas i taget. Skriv/tänk → *Visa facit* →
  bedöm dig själv (Träffade/Delvis/Missade) → nästa. Följdfrågor en i taget. Feedback med fas-för-fas-
  poäng. Och **tail**: fallet slutar aldrig vid diagnosen — det eskalerar vidare, precis som motorns idé.
  Funkar offline, inget sparas mellan omladdningar.
- **`04_engine_rules_v2.md`** — uppdaterade regler så att *Claude* kan köra fallen åt dig i chatten i
  det riktiga flödet (patient-, sköterske- och examinator-roller, fas för fas, SBAR, bemötande, oändlig tail).

## Hur du använder dem

- **Snabb solo-drill, låg energi:** öppna `simtenta_spel.html`, tryck "Slumpa HIGH-yield", kör igenom.
- **Vill ha en motspelare:** klistra in `04_engine_rules_v2.md` + `cases_simtenta.json` i en ny chatt
  och låt Claude spela patient/sköterska/examinator.
- **Ren resonemangs-/diff-grillning:** `autismfinal` står kvar orörd och är fortfarande bra för just det.

Den gamla motorn är inte fel — den är ett halvt verktyg. Det här gör flödet helt.
