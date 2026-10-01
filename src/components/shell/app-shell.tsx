"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgeIndianRupee,
  Boxes,
  Building2,
  CheckSquare,
  ClipboardCheck,
  ClipboardList,
  FileText,
  FolderOpen,
  LayoutDashboard,
  type LucideIcon,
  Menu,
  PackageCheck,
  Receipt,
  Search,
  Send,
  Settings,
  Sparkles,
  Truck,
  Upload,
  Users,
  Wallet,
} from "lucide-react";

import { DemoBanner } from "@/components/auth/demo-banner";
import { Bell } from "@/components/notifications/Bell";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { signOut } from "@/lib/auth/actions";
import type { AppRole, CurrentUser } from "@/lib/auth/get-user";
import { cn } from "@/lib/utils";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Roles allowed to see this item. Empty = everyone. */
  roles?: AppRole[];
}

const FINANCE_ROLES: AppRole[] = ["owner", "finance", "admin"];

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Requirements", href: "/requirements", icon: ClipboardList },
  { label: "Approvals", href: "/approvals", icon: ClipboardCheck },
  { label: "Tasks", href: "/tasks", icon: CheckSquare },
  { label: "OEM Sourcing", href: "/oem-sourcing", icon: Send },
  { label: "Quotations", href: "/quotations", icon: FileText },
  { label: "Orders", href: "/orders", icon: PackageCheck },
  { label: "Fulfilment & PDI", href: "/fulfilment", icon: Truck },
  { label: "Invoices", href: "/invoices", icon: Receipt, roles: FINANCE_ROLES },
  { label: "Payments", href: "/payments", icon: Wallet, roles: FINANCE_ROLES },
  {
    label: "Commission",
    href: "/commission",
    icon: BadgeIndianRupee,
    roles: FINANCE_ROLES,
  },
  { label: "Documents", href: "/documents", icon: FolderOpen },
  { label: "Customers", href: "/customers", icon: Building2 },
  { label: "OEMs", href: "/oems", icon: Users },
  { label: "Products", href: "/products", icon: Boxes },
  { label: "Search", href: "/search", icon: Search },
  { label: "Ask (AI)", href: "/ask", icon: Sparkles },
  { label: "Imports", href: "/imports", icon: Upload },
  { label: "Admin", href: "/admin/users", icon: Settings, roles: ["admin"] },
];

export function visibleNavItems(roles: AppRole[]): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => !item.roles || item.roles.some((role) => roles.includes(role)),
  );
}

function initials(name: string | null, email: string | null): string {
  const source = name ?? email ?? "?";
  return source
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function NavLinks({
  items,
  onNavigate,
}: {
  items: NavItem[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 p-2">
      {items.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function CompactNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col items-center gap-1 p-2">
      {items.map((item) => {
        const Icon = item.icon;
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Tooltip key={item.href}>
            <TooltipTrigger asChild>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-muted-foreground hover:bg-muted hover:text-foreground flex size-10 items-center justify-center rounded-md",
                  active && "bg-muted text-foreground",
                )}
              >
                <Icon className="size-4" aria-hidden="true" />
                <span className="sr-only">{item.label}</span>
              </Link>
            </TooltipTrigger>
            <TooltipContent side="right">{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}

function UserMenu({ user }: { user: CurrentUser }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="gap-2 px-2">
          <Avatar>
            <AvatarFallback>
              {initials(user.fullName, user.email)}
            </AvatarFallback>
          </Avatar>
          <span className="hidden text-sm font-medium sm:inline">
            {user.fullName ?? user.email}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">
              {user.fullName ?? "User"}
            </span>
            <span className="text-muted-foreground text-xs">{user.email}</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {user.roles.map((role) => (
                <Badge key={role} variant="secondary" className="capitalize">
                  {role}
                </Badge>
              ))}
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <form action={signOut}>
          <DropdownMenuItem asChild>
            <button type="submit" className="w-full cursor-pointer text-left">
              Sign out
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell({
  user,
  demoMode,
  children,
}: {
  user: CurrentUser;
  demoMode: boolean;
  children: React.ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const items = visibleNavItems(user.roles);

  return (
    <div className="flex min-h-svh flex-col">
      {demoMode ? <DemoBanner /> : null}
      <div className="flex flex-1">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "bg-sidebar text-sidebar-foreground hidden border-r md:flex md:flex-col",
            collapsed ? "w-16" : "w-64",
          )}
        >
          <div className="flex h-14 items-center gap-2 border-b px-3">
            <div className="bg-sidebar-primary text-sidebar-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-md text-xs font-bold">
              DC
            </div>
            {!collapsed ? (
              <span className="truncate text-sm font-semibold">
                Defence Contract CRM
              </span>
            ) : null}
          </div>
          <div className="flex-1 overflow-y-auto">
            {collapsed ? (
              <CompactNav items={items} />
            ) : (
              <NavLinks items={items} />
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="bg-background sticky top-0 z-20 flex h-14 items-center gap-2 border-b px-3">
            {/* Mobile menu */}
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="md:hidden">
                  <Menu className="size-5" aria-hidden="true" />
                  <span className="sr-only">Open navigation</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 p-0">
                <SheetHeader className="border-b">
                  <SheetTitle>Defence Contract CRM</SheetTitle>
                </SheetHeader>
                <NavLinks items={items} onNavigate={() => setMobileOpen(false)} />
              </SheetContent>
            </Sheet>

            <Button
              variant="ghost"
              size="icon"
              className="hidden md:inline-flex"
              onClick={() => setCollapsed((value) => !value)}
            >
              <Menu className="size-5" aria-hidden="true" />
              <span className="sr-only">Toggle sidebar</span>
            </Button>

            <span className="truncate text-sm font-semibold md:hidden">
              Defence Contract CRM
            </span>

            <div className="ml-auto flex items-center gap-2">
              <div className="hidden items-center gap-1 lg:flex">
                {user.roles.map((role) => (
                  <Badge key={role} variant="secondary" className="capitalize">
                    {role}
                  </Badge>
                ))}
              </div>
              <Separator orientation="vertical" className="hidden h-6 lg:block" />
              <Bell />
              <UserMenu user={user} />
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
