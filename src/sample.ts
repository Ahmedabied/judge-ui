// A small made-up pool for trying the app. Written for this repo; no outside text.

const docs: [string, string, string, string, string][] = [
  ["q1", "how long to boil an egg", "e1", "Soft and hard boiled eggs", "Lower the eggs into boiling water. Six minutes gives a soft yolk, nine to ten a firm one. Cool them in cold water to stop the cooking."],
  ["q1", "how long to boil an egg", "e2", "Egg nutrition", "An egg has about six grams of protein and is a source of vitamin B12 and choline."],
  ["q1", "how long to boil an egg", "e3", "Poached eggs", "Crack the egg into gently simmering water with a splash of vinegar and cook for three minutes."],
  ["q1", "how long to boil an egg", "e4", "Boiling times at altitude", "Water boils at a lower temperature at altitude, so boiled eggs need one or two minutes more above 1,500 metres."],
  ["q2", "train from london to edinburgh", "t1", "London to Edinburgh by rail", "Direct trains leave King's Cross about every half hour and take four and a half hours."],
  ["q2", "train from london to edinburgh", "t2", "Edinburgh festival dates", "The festival runs for three weeks in August across hundreds of venues."],
  ["q2", "train from london to edinburgh", "t3", "Sleeper trains in Britain", "The overnight sleeper runs from London Euston to Scotland, including Edinburgh, six nights a week."],
  ["q2", "train from london to edinburgh", "t4", "Driving from London to Edinburgh", "The drive is about 400 miles and takes seven to eight hours without stops."],
  ["q3", "reset a router password", "r1", "Factory reset", "Hold the reset button for ten seconds while the router is on. The admin password returns to the one on the label."],
  ["q3", "reset a router password", "r2", "Choosing a strong password", "Use a long passphrase of several unrelated words rather than a short complex word."],
  ["q3", "reset a router password", "r3", "Changing the Wi-Fi name", "Open the admin page, go to wireless settings and edit the network name."],
  ["q4", "python read csv file", "p1", "csv module", "Open the file with newline='' and pass it to csv.reader or csv.DictReader to read rows."],
  ["q4", "python read csv file", "p2", "Reading JSON in Python", "json.load reads a whole JSON document from an open file."],
  ["q4", "python read csv file", "p3", "Large CSV files", "Read big files row by row instead of loading them whole; the csv module already streams."],
  ["q4", "python read csv file", "p4", "Spreadsheet formulas", "A formula starts with an equals sign and can refer to other cells."],
];

export const SAMPLE_POOL = docs
  .map(([query_id, query, doc_id, title, text]) => JSON.stringify({ query_id, query, doc_id, title, text }))
  .join("\n");
