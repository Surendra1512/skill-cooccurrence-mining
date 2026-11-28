/** Project brief and team details (from the official project sheet). */

export const PROJECT = {
  title: "Skill Co-Occurrence Mining for Cooperative Employment Planning",
  problem: "Skills are trained one qualification at a time, although employers hire for combinations no single qualification covers.",
  users: ["Cooperative employment programmes", "Training providers", "Jobseekers"],
  deliverables: [
    "Build a discovery system that mines which skills genuinely co-occur in demand, to guide combined training offers.",
    "Produce a ranked skill association rule set with lift, and the training combinations it implies.",
    "Report support, confidence and lift, and share which rules survive lift filtering.",
  ],
  baseline: "Individual skill frequency (mandatory).",
  deliverable: "Training planning dashboard.",
  technique: "Association rule mining over skill sets; lift-based filtering.",
  units: [
    { unit: "Unit VI", topic: "Association and sequence mining", where: "Apriori, FP-Growth, rule generation, temporal re-mining" },
    { unit: "Unit II", topic: "Preprocessing, scaling and feature engineering", where: "Cleaning, skill normalisation, transaction encoding" },
    { unit: "Unit V", topic: "Cluster validity and evaluation", where: "Algorithm agreement, metric validation, rule-set stability" },
  ],
  data: "Public job-posting datasets with extracted skill lists (found and cited by the team).",
  extension: "Track how the strongest combinations shift over time.",
  sih: {
    event: "Smart India Hackathon 2026",
    psId: "SIH26087",
    theme: "AI-Enabled Cooperative Capacity Building, ERP & Employment Ecosystem",
    organisation: "Ministry of Cooperation",
    url: "https://sih.gov.in/sih2026PS",
    datasetAccess: "Student-sourced public data",
  },
} as const;

export const TEAM = {
  members: [
    { name: "Surendra Reddy Kota", regNo: "12418513" },
    { name: "Katikala Srisaa", regNo: "12410329" },
  ],
  faculty: "Piyush Sharma",
  department: "Computer Science and Engineering (AI and ML)",
  university: "Lovely Professional University",
  location: "Phagwara, Punjab",
} as const;
