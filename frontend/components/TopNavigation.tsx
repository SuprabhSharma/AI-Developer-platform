"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Project, User } from "@/types/api";
import Icon from "@/components/Icon";

interface TopNavigationProps {
  projects?: Project[];
  currentProject?: Project | null;
  projectsLoading?: boolean;
  onToggleChat?: () => void;
  chatVisible?: boolean;
}

function initials(user: User | null, fallback = "U") {
  const source = user?.full_name || user?.email || fallback;
  return source.split(/[ @._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("") || fallback;
}

export default function TopNavigation({ projects = [], currentProject, projectsLoading, onToggleChat, chatVisible = true }: TopNavigationProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<User | null>(null);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    apiFetch<User>("/auth/me").then(setUser).catch(() => undefined);
  }, []);

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      const target = event.target as Node;
      if (!projectMenuRef.current?.contains(target)) setProjectMenuOpen(false);
      if (!userMenuRef.current?.contains(target)) setUserMenuOpen(false);
    }
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  function logout() {
    localStorage.removeItem("access_token");
    localStorage.removeItem("refresh_token");
    router.replace("/login");
  }

  const label = currentProject?.name || (pathname === "/projects" ? "Projects" : "Choose project");

  return (
    <header className="top-nav">
      <div className="top-nav-left">
        <Link href="/projects" className="brand" aria-label="Go to projects">
          <span className="brand-mark"><Icon name="github" size={17} /></span>
          <span className="brand-name">Forge</span>
        </Link>
        <span className="nav-divider" />
        <div className="menu-anchor" ref={projectMenuRef}>
          <button type="button" className="project-switcher" onClick={() => setProjectMenuOpen((open) => !open)} aria-expanded={projectMenuOpen}>
            <span className="project-switcher-name">{label}</span>
            <Icon name="chevron-down" size={14} />
          </button>
          {projectMenuOpen && (
            <div className="dropdown project-dropdown">
              <div className="dropdown-label">Switch project</div>
              <button type="button" className="dropdown-item" onClick={() => { router.push("/projects"); setProjectMenuOpen(false); }}>
                <span className="project-avatar project-avatar-muted">P</span><span>All projects</span>
              </button>
              {projectsLoading && <div className="dropdown-loading"><span className="spinner spinner-small" /> Loading projects</div>}
              {projects.map((project) => (
                <button type="button" key={project.id} className={`dropdown-item ${currentProject?.id === project.id ? "dropdown-item-active" : ""}`} onClick={() => { router.push(`/projects/${project.id}`); setProjectMenuOpen(false); }}>
                  <span className="project-avatar">{project.name.slice(0, 1).toUpperCase()}</span><span className="truncate">{project.name}</span>
                  {currentProject?.id === project.id && <Icon name="check" size={14} />}
                </button>
              ))}
              {!projectsLoading && projects.length === 0 && <div className="dropdown-empty">No projects yet</div>}
            </div>
          )}
        </div>
        {currentProject && <span className="branch-indicator"><Icon name="branch" size={14} /> main</span>}
      </div>
      <div className="top-nav-right">
        <Link href="/usage" className={`usage-link ${pathname === "/usage" ? "usage-link-active" : ""}`}><Icon name="activity" size={15} /> Usage</Link>
        {onToggleChat && <button type="button" className={`nav-icon-button ${chatVisible ? "nav-icon-active" : ""}`} onClick={onToggleChat} aria-label={chatVisible ? "Hide chat panel" : "Show chat panel"} title="Toggle chat panel"><Icon name="sparkle" size={16} /></button>}
        <div className="menu-anchor" ref={userMenuRef}>
          <button type="button" className="user-button" onClick={() => setUserMenuOpen((open) => !open)} aria-expanded={userMenuOpen}>
            <span className="avatar">{initials(user)}</span>
            <span className="user-email">{user?.email || "Account"}</span>
            <Icon name="chevron-down" size={14} />
          </button>
          {userMenuOpen && (
            <div className="dropdown user-dropdown">
              <div className="user-summary"><span className="avatar avatar-large">{initials(user)}</span><div className="min-w-0"><strong>{user?.full_name || "Developer"}</strong><span className="truncate">{user?.email || "Signed-in account"}</span></div></div>
              <div className="dropdown-rule" />
              <button type="button" className="dropdown-item dropdown-danger" onClick={logout}><Icon name="logout" size={15} /><span>Log out</span></button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
