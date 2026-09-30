"use client";

import type { ColumnDef } from "@tanstack/react-table";

import { RoleManager, type UserRow } from "@/components/admin/role-manager";
import { DataTableShell } from "@/components/data-table-shell";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";

const columns: ColumnDef<UserRow, unknown>[] = [
  {
    accessorKey: "fullName",
    header: "Name",
    cell: ({ row }) => (
      <span className="font-medium">{row.original.fullName ?? "—"}</span>
    ),
  },
  {
    accessorKey: "email",
    header: "Email",
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.email ?? "—"}</span>
    ),
  },
  {
    id: "roles",
    header: "Roles",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.roles.length === 0 ? (
          <span className="text-muted-foreground text-sm">No roles</span>
        ) : (
          row.original.roles.map((role) => (
            <Badge key={role} variant="secondary" className="capitalize">
              {role}
            </Badge>
          ))
        )}
      </div>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={row.original.isActive ? "default" : "outline"}>
        {row.original.isActive ? "Active" : "Inactive"}
      </Badge>
    ),
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <RoleManager user={row.original} />,
  },
];

export function UsersTable({ rows }: { rows: UserRow[] }) {
  return (
    <DataTableShell
      columns={columns}
      data={rows}
      pageSize={10}
      emptyState={
        <EmptyState
          title="No users yet"
          purpose="Seeded users and profiles will appear here."
        />
      }
    />
  );
}
