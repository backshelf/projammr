import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import {
  ProjectProvider,
  useProject,
  useProjectRole,
} from "./use-project-role";

afterEach(cleanup);

function Probe() {
  const project = useProject();
  const role = useProjectRole();

  return (
    <div>
      <span data-testid="id">{project.id}</span>
      <span data-testid="name">{project.name}</span>
      <span data-testid="role">{project.role}</span>
      <span data-testid="can-editor">{String(project.can("editor"))}</span>
      <span data-testid="role-hook">{role?.role ?? "null"}</span>
    </div>
  );
}

function ThrowingProbe() {
  useProject();
  return null;
}

function RoleOnlyProbe() {
  const role = useProjectRole();
  return (
    <span data-testid="role-hook">{role === null ? "null" : role.role}</span>
  );
}

describe("useProject", () => {
  it("returns the id, name and role inside the provider", () => {
    render(
      <ProjectProvider project={{ id: 7, name: "Sessions", role: "editor" }}>
        <Probe />
      </ProjectProvider>
    );

    expect(screen.getByTestId("id").textContent).toBe("7");
    expect(screen.getByTestId("name").textContent).toBe("Sessions");
    expect(screen.getByTestId("role").textContent).toBe("editor");
    expect(screen.getByTestId("role-hook").textContent).toBe("editor");
  });

  it("can() compares against the provider's role", () => {
    render(
      <ProjectProvider project={{ id: 1, name: "Viewer only", role: "viewer" }}>
        <Probe />
      </ProjectProvider>
    );

    expect(screen.getByTestId("can-editor").textContent).toBe("false");
  });

  it("throws outside the provider and useProjectRole returns null", () => {
    expect(() => renderThrowing()).toThrow(
      "useProject() was called outside a project route"
    );

    render(<RoleOnlyProbe />);
    expect(screen.getByTestId("role-hook").textContent).toBe("null");
  });
});

function renderThrowing() {
  // React logs an error boundary trace to the console for a render that
  // throws; that is noise, not a failure, so the assertion is on the throw
  // itself rather than console output.
  render(<ThrowingProbe />);
}
