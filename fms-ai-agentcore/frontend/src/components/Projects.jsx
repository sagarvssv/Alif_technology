import React, { useEffect, useState } from "react";
import "./Projects.css";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  "https://c0feinpvm5.execute-api.eu-central-1.amazonaws.com/prod";

const PROJECTS_API = `${API_BASE_URL}/projects`;

// ─── Temporary local persistence ───────────────────────────────────────
// Until the /projects backend (DynamoDB-backed Lambda) is deployed, project
// data is cached in localStorage so this screen is fully usable right away.
// Swap loadLocalProjects/saveLocalProjects below for the fetch() calls in
// fetchProjects()/createProject() once the API is live — the rest of the
// component does not need to change.
const LOCAL_KEY = "alif_projects_v1";

function loadLocalProjects() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalProjects(list) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch {}
}

function createId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `proj-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatDate(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDateOnly(value) {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value));
  } catch {
    return value;
  }
}

const ENTITY_TYPES = [
  "Private Limited",
  "Public Limited",
  "LLC",
  "Partnership",
  "Sole Proprietorship",
  "Branch Office",
  "Free Zone Entity",
  "Other",
];

// ─── Project schema ──────────────────────────────────────────────────────
// Fields chosen to match what an auditor actually needs when reopening a
// closed engagement a year (or several) later — legal identity, official
// registration numbers, the exact audited period, who was accountable, and
// the entity's structure. See ISA 230 (Audit Documentation) for the basis.
const EMPTY_FORM = {
  // Project basics
  projectName: "",
  projectDescription: "",

  // Company identity
  legalName: "",
  registeredAddress: "",
  cin: "",
  taxRegistrationNumber: "",
  incorporationDate: "",
  entityType: "",
  subsidiaries: "",

  // Key officials
  contactNumber: "",
  ceo: "",
  principalContact: "",
  owner: "",

  // Audit scope
  auditPeriodStart: "",
  auditPeriodEnd: "",
  auditDescription: "",
};

function Projects({ onOpenProject }) {
  const [tab, setTab] = useState("existing"); // "create" | "existing"
  const [form, setForm] = useState(EMPTY_FORM);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // "all" | "ongoing"
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState("az"); // "az" | "za" | "newest"
  const [selectedForDelete, setSelectedForDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  async function fetchProjects() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(PROJECTS_API);
      if (!res.ok) throw new Error("API not available");
      const data = await res.json();
      setProjects(data.projects || data.items || []);
    } catch {
      // Backend not deployed yet — fall back to local cache.
      setProjects(loadLocalProjects());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchProjects();
  }, []);

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function validateForm() {
    if (!form.projectName.trim()) return "Project name is required.";
    if (!form.legalName.trim()) return "Company name is required.";
    if (!form.auditPeriodStart || !form.auditPeriodEnd) return "Audited period (start and end) is required.";
    return "";
  }

  async function handleCreate(e) {
    e.preventDefault();
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError("");

    const project = {
      projectId: createId(),

      projectName: form.projectName.trim(),
      projectDescription: form.projectDescription.trim(),

      legalName: form.legalName.trim(),
      registeredAddress: form.registeredAddress.trim(),
      cin: form.cin.trim(),
      taxRegistrationNumber: form.taxRegistrationNumber.trim(),
      incorporationDate: form.incorporationDate || "",
      entityType: form.entityType,
      subsidiaries: form.subsidiaries.trim(),

      contactNumber: form.contactNumber.trim(),
      ceo: form.ceo.trim(),
      principalContact: form.principalContact.trim(),
      owner: form.owner.trim(),

      auditPeriodStart: form.auditPeriodStart,
      auditPeriodEnd: form.auditPeriodEnd,
      auditDescription: form.auditDescription.trim(),

      status: "Active",
      createdAt: new Date().toISOString(),
      history: [
        {
          timestamp: new Date().toISOString(),
          action: "created",
          note: "Project created.",
        },
      ],
    };

    try {
      const res = await fetch(PROJECTS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(project),
      });
      if (!res.ok) throw new Error("API not available");
      const data = await res.json();
      const saved = data.project || project;
      setProjects((prev) => [saved, ...prev]);
    } catch {
      // Backend not deployed yet — persist locally instead.
      const updated = [project, ...loadLocalProjects()];
      saveLocalProjects(updated);
      setProjects(updated);
    } finally {
      setSaving(false);
      setForm(EMPTY_FORM);
      setTab("existing");
    }
  }

  function openProject(project) {
    onOpenProject?.(project);
  }

  async function deleteSelectedProject() {
    if (!selectedForDelete) return;
    const project = projects.find((p) => p.projectId === selectedForDelete);
    if (!project) return;

    const confirmed = window.confirm(
      `Delete "${project.projectName}"? This cannot be undone.`
    );
    if (!confirmed) return;

    setDeleting(true);
    setError("");

    try {
      const res = await fetch(`${PROJECTS_API}/${selectedForDelete}`, { method: "DELETE" });
      if (!res.ok) throw new Error("API not available");
      setProjects((prev) => prev.filter((p) => p.projectId !== selectedForDelete));
    } catch {
      // Backend not deployed yet — remove from local cache instead.
      const updated = loadLocalProjects().filter((p) => p.projectId !== selectedForDelete);
      saveLocalProjects(updated);
      setProjects(updated);
    } finally {
      setSelectedForDelete(null);
      setDeleting(false);
    }
  }

  function getVisibleProjects() {
    let list = [...projects];

    if (statusFilter === "ongoing") {
      list = list.filter((p) => (p.status || "Active").toLowerCase() === "active");
    }

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((p) =>
        (p.projectName || "").toLowerCase().startsWith(q) ||
        (p.legalName || p.companyAuditName || "").toLowerCase().startsWith(q)
      );
    }

    list.sort((a, b) => {
      if (sortOrder === "az") return (a.projectName || "").localeCompare(b.projectName || "");
      if (sortOrder === "za") return (b.projectName || "").localeCompare(a.projectName || "");
      if (sortOrder === "newest") return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
      return 0;
    });

    return list;
  }

  return (
    <div className="projects-view">
      {tab === "create" && (
        <button className="projects-back-link" onClick={() => setTab("existing")}>
          ← Back to Projects
        </button>
      )}

      {error && (
        <div className="projects-error">
          ⚠️ {error}
          <button onClick={() => setError("")}>✕</button>
        </div>
      )}

      {tab === "create" && (
        <form className="project-form" onSubmit={handleCreate}>

          <div className="project-form-section-title">Project Basics</div>

          <div className="project-form-field">
            <label>Project Name</label>
            <input
              type="text"
              placeholder="e.g. FY2026 Statutory Audit — WeVoice LLC"
              value={form.projectName}
              onChange={(e) => updateField("projectName", e.target.value)}
            />
          </div>

          <div className="project-form-field">
            <label>Project Description</label>
            <textarea
              rows={2}
              placeholder="Brief summary of what this engagement covers..."
              value={form.projectDescription}
              onChange={(e) => updateField("projectDescription", e.target.value)}
            />
          </div>

          <div className="project-form-section-title">Company Details</div>

          <div className="project-form-field">
            <label>Company Name (Audit Company)</label>
            <input
              type="text"
              placeholder="Official registered name of the business"
              value={form.legalName}
              onChange={(e) => updateField("legalName", e.target.value)}
            />
          </div>

          <div className="project-form-field">
            <label>Registered Address</label>
            <textarea
              rows={2}
              placeholder="Principal place of business / corporate headquarters"
              value={form.registeredAddress}
              onChange={(e) => updateField("registeredAddress", e.target.value)}
            />
          </div>

          <div className="project-form-row">
            <div className="project-form-field">
              <label>CIN (Corporate Identity Number)</label>
              <input
                type="text"
                placeholder="e.g. U12345MH2020PLC123456"
                value={form.cin}
                onChange={(e) => updateField("cin", e.target.value)}
              />
            </div>
            <div className="project-form-field">
              <label>Tax Registration No. (TRN)</label>
              <input
                type="text"
                placeholder="e.g. 100123456700003"
                value={form.taxRegistrationNumber}
                onChange={(e) => updateField("taxRegistrationNumber", e.target.value)}
              />
            </div>
          </div>

          <div className="project-form-row">
            <div className="project-form-field">
              <label>Incorporation Date</label>
              <input
                type="date"
                value={form.incorporationDate}
                onChange={(e) => updateField("incorporationDate", e.target.value)}
              />
            </div>
            <div className="project-form-field">
              <label>Entity Type</label>
              <select
                value={form.entityType}
                onChange={(e) => updateField("entityType", e.target.value)}
              >
                <option value="">Select entity type…</option>
                {ENTITY_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="project-form-field">
            <label>Subsidiaries / Branch Offices</label>
            <textarea
              rows={2}
              placeholder="List any major subsidiaries or branch offices, if applicable"
              value={form.subsidiaries}
              onChange={(e) => updateField("subsidiaries", e.target.value)}
            />
          </div>

          <div className="project-form-section-title">Key Officials</div>

          <div className="project-form-row">
            <div className="project-form-field">
              <label>CEO</label>
              <input
                type="text"
                placeholder="Chief Executive Officer"
                value={form.ceo}
                onChange={(e) => updateField("ceo", e.target.value)}
              />
            </div>
            <div className="project-form-field">
              <label>Contact Number</label>
              <input
                type="tel"
                placeholder="e.g. +971 50 123 4567"
                value={form.contactNumber}
                onChange={(e) => updateField("contactNumber", e.target.value)}
              />
            </div>
          </div>

          <div className="project-form-row">
            <div className="project-form-field">
              <label>Principal Contact Person</label>
              <input
                type="text"
                placeholder="Name and role of the main point of contact"
                value={form.principalContact}
                onChange={(e) => updateField("principalContact", e.target.value)}
              />
            </div>
            <div className="project-form-field">
              <label>Owner</label>
              <input
                type="text"
                placeholder="Person responsible for this engagement internally"
                value={form.owner}
                onChange={(e) => updateField("owner", e.target.value)}
              />
            </div>
          </div>

          <div className="project-form-section-title">Audit Scope</div>

          <div className="project-form-row">
            <div className="project-form-field">
              <label>Audited Period — Start</label>
              <input
                type="date"
                value={form.auditPeriodStart}
                onChange={(e) => updateField("auditPeriodStart", e.target.value)}
              />
            </div>
            <div className="project-form-field">
              <label>Audited Period — End</label>
              <input
                type="date"
                value={form.auditPeriodEnd}
                onChange={(e) => updateField("auditPeriodEnd", e.target.value)}
              />
            </div>
          </div>

          <div className="project-form-field">
            <label>Audit Description</label>
            <textarea
              rows={3}
              placeholder="Scope, standards, and objectives of the audit..."
              value={form.auditDescription}
              onChange={(e) => updateField("auditDescription", e.target.value)}
            />
          </div>

          <div className="project-form-actions">
            <button
              type="button"
              className="project-form-cancel"
              onClick={() => { setForm(EMPTY_FORM); setError(""); setTab("existing"); }}
            >
              Cancel
            </button>
            <button type="submit" className="project-form-submit" disabled={saving}>
              {saving ? "Creating…" : "Create Project"}
            </button>
          </div>
        </form>
      )}

      {tab === "existing" && (
        <div className="projects-list-wrap">
          <div className="projects-toolbar">
            <div className="projects-page-title">Projects</div>
            <div className="projects-toolbar-controls">
              <div className="projects-filter-group">
                <button
                  className={`projects-filter-btn ${statusFilter === "all" ? "projects-filter-active" : ""}`}
                  onClick={() => setStatusFilter("all")}
                >
                  All
                </button>
                <button
                  className={`projects-filter-btn ${statusFilter === "ongoing" ? "projects-filter-active" : ""}`}
                  onClick={() => setStatusFilter("ongoing")}
                >
                  Ongoing
                </button>
              </div>

              <select
                className="projects-sort-select"
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value)}
              >
                <option value="az">Sort: A-Z</option>
                <option value="za">Sort: Z-A</option>
                <option value="newest">Sort: Newest</option>
              </select>

              <div className="projects-search-box">
                <span className="projects-search-icon">🔍</span>
                <input
                  type="text"
                  placeholder="Search project"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>

              <button className="projects-add-btn" onClick={() => setTab("create")}>
                + Add Project
              </button>

              {selectedForDelete && (
                <button
                  className="projects-delete-btn"
                  onClick={deleteSelectedProject}
                  disabled={deleting}
                >
                  🗑 {deleting ? "Deleting…" : "Delete Selected"}
                </button>
              )}
            </div>
          </div>

          {loading && <p className="projects-muted">Loading projects…</p>}

          {!loading && projects.length === 0 && (
            <div className="projects-empty">
              <div className="projects-empty-icon">📁</div>
              <p>No projects yet.</p>
              <button className="projects-empty-cta" onClick={() => setTab("create")}>
                + Create your first project
              </button>
            </div>
          )}

          {!loading && projects.length > 0 && getVisibleProjects().length === 0 && (
            <p className="projects-muted">No projects match your search/filter.</p>
          )}

          {!loading && getVisibleProjects().length > 0 && (
            <div className="projects-table-wrap">
              <div className="projects-table">
                <div className="projects-table-header-row">
                  <div className="projects-table-check-col"></div>
                  <div>Project Name</div>
                  <div>Audit Company</div>
                  <div>Audit Start</div>
                  <div>Audit End</div>
                  <div>Owner</div>
                  <div>Status</div>
                  <div className="projects-table-arrow-col"></div>
                </div>

                {getVisibleProjects().map((p) => {
                  const isActive = (p.status || "Active").toLowerCase() === "active";
                  return (
                    <div key={p.projectId} className="projects-table-row">
                      <label className="project-row-radio" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="radio"
                          name="project-delete-select"
                          checked={selectedForDelete === p.projectId}
                          onChange={() =>
                            setSelectedForDelete((prev) => (prev === p.projectId ? null : p.projectId))
                          }
                        />
                      </label>

                      <button className="projects-table-name-btn" onClick={() => openProject(p)}>
                        {p.projectName}
                      </button>

                      <div className="projects-table-cell">
                        {p.legalName || p.companyAuditName || p.entityType || "—"}
                      </div>

                      <div className="projects-table-cell projects-table-date projects-table-date-start">
                        {formatDateOnly(p.auditPeriodStart) || "—"}
                      </div>

                      <div className="projects-table-cell projects-table-date projects-table-date-end">
                        {formatDateOnly(p.auditPeriodEnd) || "—"}
                      </div>

                      <div className="projects-table-cell">{p.owner || "—"}</div>

                      <div className="projects-table-cell">
                        <span className={`projects-status-pill ${isActive ? "status-active" : "status-inactive"}`}>
                          {isActive ? "✅ Active" : (p.status || "Inactive")}
                        </span>
                      </div>

                      <button
                        className="projects-table-open-btn"
                        onClick={() => openProject(p)}
                        aria-label={`Open ${p.projectName}`}
                      >
                        ›
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Projects;
