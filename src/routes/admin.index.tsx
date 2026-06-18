import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useAuth, useHasRole, type AppRole } from "@/lib/auth";
import { AppShell, PageHeader } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  listUsers,
  setUserRoles,
  deleteUser,
  updateUserProfile,
  adminCreateUser,
  adminSetUserPassword,
  adminSendPasswordReset,
} from "@/lib/admin.functions";
import { setTelemarketerGoal } from "@/lib/telemarketer.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROLE_LABELS } from "@/lib/constants";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [
      { title: "Users — LeadVault" },
      { name: "description", content: "Approve vendors and assign roles." },
    ],
  }),
  component: AdminPage,
});

const ALL_ROLES: AppRole[] = ["admin", "sales", "vendor", "telemarketer", "pending"];

function AdminPage() {
  const { user, loading } = useAuth();
  const isAdmin = useHasRole("admin");
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", replace: true });
  }, [user, loading, navigate]);

  if (loading || !user) return null;

  return (
    <AppShell>
      <PageHeader title="User management" description="Assign roles to vendors and sales agents." />
      {!isAdmin ? (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">Admin access required.</CardContent></Card>
      ) : (
        <UsersTable />
      )}
    </AppShell>
  );
}

function UsersTable() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const fetchUsers = useServerFn(listUsers);
  const updateRoles = useServerFn(setUserRoles);
  const removeUser = useServerFn(deleteUser);
  const updateProfile = useServerFn(updateUserProfile);
  const setGoal = useServerFn(setTelemarketerGoal);
  const createUser = useServerFn(adminCreateUser);
  const setPasswordFn = useServerFn(adminSetUserPassword);
  const sendResetFn = useServerFn(adminSendPasswordReset);
  const [pwInput, setPwInput] = useState("");
  const [pwShown, setPwShown] = useState<string | null>(null);

  const setPwM = useMutation({
    mutationFn: async () => {
      if (!editInfo) return null;
      if (pwInput.trim().length < 8) throw new Error("Password must be at least 8 characters");
      const res = await setPasswordFn({
        data: { target_user_id: editInfo.id, password: pwInput.trim() },
      });
      return res.password;
    },
    onSuccess: (pw) => {
      if (pw) {
        setPwShown(pw);
        setPwInput("");
        toast.success("Password updated — share it with the user now.");
      }
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const sendResetM = useMutation({
    mutationFn: async () => {
      if (!editInfo) return null;
      const redirect =
        typeof window !== "undefined" ? `${window.location.origin}/reset-password` : undefined;
      const res = await sendResetFn({
        data: { target_user_id: editInfo.id, redirect_to: redirect },
      });
      return res.email;
    },
    onSuccess: (email) => {
      if (email) toast.success(`Password reset link sent to ${email}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const usersQ = useQuery({ queryKey: ["admin-users"], queryFn: () => fetchUsers() });
  const emptyNew = {
    email: "",
    password: "",
    full_name: "",
    company_name: "",
    default_lead_rate: "",
    roles: ["sales"] as AppRole[],
  };
  const [newUser, setNewUser] = useState<typeof emptyNew | null>(null);

  const toggleNewRole = (r: AppRole) => {
    if (!newUser) return;
    const has = newUser.roles.includes(r);
    setNewUser({
      ...newUser,
      roles: has ? newUser.roles.filter((x) => x !== r) : [...newUser.roles, r],
    });
  };

  const createM = useMutation({
    mutationFn: async () => {
      if (!newUser) return;
      if (newUser.roles.length === 0) throw new Error("Pick at least one role");
      await createUser({
        data: {
          email: newUser.email.trim(),
          password: newUser.password,
          full_name: newUser.full_name.trim(),
          company_name: newUser.company_name.trim(),
          roles: newUser.roles,
          default_lead_rate:
            newUser.default_lead_rate.trim() === ""
              ? null
              : Number(newUser.default_lead_rate),
        },
      });
    },
    onSuccess: () => {
      toast.success("User created");
      setNewUser(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });
  const [editInfo, setEditInfo] = useState<{
    id: string;
    full_name: string;
    company_name: string;
    email: string;
    default_lead_rate: string;
    bypass_litigator: boolean;
    min_vehicles: string;
    max_age: string;
    is_vendor: boolean;
    roles: AppRole[];
    goal_calls: string;
    goal_transfers: string;
    goal_period: "" | "day" | "week" | "month";
  } | null>(null);

  const toggleRole = (r: AppRole) => {
    if (!editInfo) return;
    const has = editInfo.roles.includes(r);
    setEditInfo({
      ...editInfo,
      roles: has ? editInfo.roles.filter((x) => x !== r) : [...editInfo.roles, r],
      is_vendor: has ? editInfo.is_vendor && r !== "vendor" : editInfo.is_vendor || r === "vendor",
    });
  };

  const deleteM = useMutation({
    mutationFn: async (id: string) => {
      await removeUser({ data: { target_user_id: id } });
    },
    onSuccess: () => {
      toast.success("User deleted");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const unfreezeM = useMutation({
    mutationFn: async (id: string) => {
      await updateProfile({ data: { target_user_id: id, frozen: false } });
    },
    onSuccess: () => {
      toast.success("User unfrozen");
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  const editInfoM = useMutation({
    mutationFn: async () => {
      if (!editInfo) return;
      if (editInfo.roles.length === 0) throw new Error("Pick at least one role");
      await updateRoles({ data: { target_user_id: editInfo.id, roles: editInfo.roles } });
      await updateProfile({
        data: {
          target_user_id: editInfo.id,
          full_name: editInfo.full_name,
          company_name: editInfo.company_name,
          email: editInfo.email,
          default_lead_rate:
            editInfo.default_lead_rate.trim() === ""
              ? null
              : Number(editInfo.default_lead_rate),
          bypass_litigator: editInfo.bypass_litigator,
          min_vehicles:
            editInfo.min_vehicles.trim() === "" ? null : Math.trunc(Number(editInfo.min_vehicles)),
          max_age:
            editInfo.max_age.trim() === "" ? null : Math.trunc(Number(editInfo.max_age)),
        },
      });
      if (editInfo.roles.includes("telemarketer")) {
        await setGoal({
          data: {
            target_user_id: editInfo.id,
            calls:
              editInfo.goal_calls.trim() === "" ? null : Math.trunc(Number(editInfo.goal_calls)),
            transfers:
              editInfo.goal_transfers.trim() === ""
                ? null
                : Math.trunc(Number(editInfo.goal_transfers)),
            period: editInfo.goal_period === "" ? null : editInfo.goal_period,
          },
        });
      }
    },
    onSuccess: () => {
      toast.success("User updated");
      setEditInfo(null);
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed"),
  });

  if (usersQ.isLoading) return <Card><CardContent className="p-6 text-sm text-muted-foreground">Loading…</CardContent></Card>;
  if (usersQ.error) return <Card><CardContent className="p-6 text-sm text-destructive">{(usersQ.error as Error).message}</CardContent></Card>;

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button onClick={() => setNewUser(emptyNew)}>Add user</Button>
      </div>
      <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Company</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Roles</TableHead>
              <TableHead className="text-right">Lead rate</TableHead>
              <TableHead>Last active</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(() => {
              const groupOrder: AppRole[] = ["admin", "sales", "vendor", "telemarketer", "pending"];
              const primary = (roles: string[]): AppRole => {
                for (const r of groupOrder) if (roles.includes(r)) return r;
                return "pending";
              };
              const users = usersQ.data ?? [];
              const grouped = groupOrder
                .map((g) => ({
                  group: g,
                  rows: users
                    .filter((u) => primary(u.roles) === g)
                    .sort((a, b) => {
                      const ac = (a.company_name || "").localeCompare(b.company_name || "");
                      if (ac !== 0) return ac;
                      return (a.full_name || a.email).localeCompare(b.full_name || b.email);
                    }),
                }))
                .filter((s) => s.rows.length > 0);
              return grouped.flatMap((section) => [
                <TableRow key={`h-${section.group}`} className="bg-muted/40 hover:bg-muted/40">
                  <TableCell colSpan={8} className="py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {ROLE_LABELS[section.group] ?? section.group}s · {section.rows.length}
                  </TableCell>
                </TableRow>,
                ...section.rows.map((u) => (
                  <TableRow key={u.id}>
                <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                <TableCell className="text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <span>{u.email}</span>
                    {(u as { frozen?: boolean }).frozen && (
                      <Badge variant="destructive" className="uppercase">Frozen</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{u.company_name || "—"}</TableCell>
                <TableCell>
                  {u.requested_role ? (
                    <Badge variant="outline">{ROLE_LABELS[u.requested_role as AppRole] ?? u.requested_role}</Badge>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {u.roles.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      u.roles.map((r) => (
                        <Badge key={r} variant={r === "pending" ? "outline" : "secondary"}>
                          {ROLE_LABELS[r] ?? r}
                        </Badge>
                      ))
                    )}
                    {u.roles.includes("telemarketer") && (
                      null
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {u.roles.includes("vendor") ? (
                    u.default_lead_rate != null ? (
                      `$${Number(u.default_lead_rate).toFixed(2)}`
                    ) : (
                      <span className="text-muted-foreground">Not set</span>
                    )
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground whitespace-nowrap">
                  {(() => {
                    const ts = (u as { last_active_at?: string | null }).last_active_at
                      ?? (u as { last_sign_in_at?: string | null }).last_sign_in_at;
                    if (!ts) return <span className="text-muted-foreground">Never</span>;
                    const d = new Date(ts);
                    return (
                      <span title={d.toLocaleString()}>
                        {d.toLocaleDateString()} {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    );
                  })()}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {(u as { frozen?: boolean }).frozen && (
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => unfreezeM.mutate(u.id)}
                          disabled={unfreezeM.isPending}
                        >
                          Unfreeze
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setEditInfo({
                            id: u.id,
                            full_name: u.full_name ?? "",
                            company_name: u.company_name ?? "",
                            email: u.email,
                            default_lead_rate:
                              u.default_lead_rate != null ? String(u.default_lead_rate) : "",
                            bypass_litigator: Boolean((u as { bypass_litigator?: boolean }).bypass_litigator),
                            min_vehicles:
                              (u as { min_vehicles?: number | null }).min_vehicles != null
                                ? String((u as { min_vehicles?: number | null }).min_vehicles)
                                : "",
                            max_age:
                              (u as { max_age?: number | null }).max_age != null
                                ? String((u as { max_age?: number | null }).max_age)
                                : "",
                            is_vendor: u.roles.includes("vendor"),
                            roles: u.roles as AppRole[],
                            goal_calls:
                              (u as { telemarketer_goal_calls?: number | null }).telemarketer_goal_calls != null
                                ? String((u as { telemarketer_goal_calls?: number | null }).telemarketer_goal_calls)
                                : "",
                            goal_transfers:
                              (u as { telemarketer_goal_transfers?: number | null }).telemarketer_goal_transfers != null
                                ? String((u as { telemarketer_goal_transfers?: number | null }).telemarketer_goal_transfers)
                                : "",
                            goal_period:
                              ((u as { telemarketer_goal_period?: string | null }).telemarketer_goal_period as "" | "day" | "week" | "month" | null) ?? "",
                          })
                        }
                      >
                        Edit
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={u.id === user?.id || deleteM.isPending}
                          >
                            Delete
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete this user?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This permanently removes {u.email} and their account access. Their submitted leads will remain. This can't be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteM.mutate(u.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Delete user
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
                )),
              ]);
            })()}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
    <Dialog
      open={!!editInfo}
      onOpenChange={(o) => {
        if (!o) {
          setEditInfo(null);
          setPwInput("");
          setPwShown(null);
        }
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Edit user</DialogTitle>
          <DialogDescription>Update roles, profile, and login email.</DialogDescription>
        </DialogHeader>
        {editInfo && (
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
            <div className="space-y-1.5 rounded-md border p-3">
              <p className="text-sm font-medium">Roles</p>
              <div className="flex flex-wrap gap-3">
                {ALL_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={editInfo.roles.includes(r)}
                      onCheckedChange={() => toggleRole(r)}
                    />
                    {ROLE_LABELS[r]}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ei-name">Full name</Label>
              <Input
                id="ei-name"
                value={editInfo.full_name}
                onChange={(e) => setEditInfo({ ...editInfo, full_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ei-email">Email</Label>
              <Input
                id="ei-email"
                type="email"
                value={editInfo.email}
                onChange={(e) => setEditInfo({ ...editInfo, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ei-company">Company</Label>
              <Input
                id="ei-company"
                value={editInfo.company_name}
                onChange={(e) => setEditInfo({ ...editInfo, company_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ei-rate">Lead rate ($ per lead)</Label>
              <Input
                id="ei-rate"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={editInfo.default_lead_rate}
                onChange={(e) =>
                  setEditInfo({ ...editInfo, default_lead_rate: e.target.value })
                }
              />
              <p className="text-xs text-muted-foreground">
                What we pay this vendor for each new lead. Applied automatically on submission.
              </p>
            </div>
            {editInfo.is_vendor && (
              <div className="space-y-1.5 rounded-md border p-3">
                <label className="flex items-center gap-2 text-sm font-medium">
                  <Checkbox
                    checked={editInfo.bypass_litigator}
                    onCheckedChange={(v) =>
                      setEditInfo({ ...editInfo, bypass_litigator: v === true })
                    }
                  />
                  Bypass TCPA litigator check for this vendor
                </label>
                <p className="text-xs text-muted-foreground">
                  When enabled, leads from this vendor skip the TCPA litigator scrub.
                </p>
              </div>
            )}
            {editInfo.is_vendor && (
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Billability requirements</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ei-minveh">Min vehicles</Label>
                    <Input
                      id="ei-minveh"
                      type="number"
                      step="1"
                      min="0"
                      placeholder="default 2"
                      value={editInfo.min_vehicles}
                      onChange={(e) =>
                        setEditInfo({ ...editInfo, min_vehicles: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ei-maxage">Max customer age</Label>
                    <Input
                      id="ei-maxage"
                      type="number"
                      step="1"
                      min="0"
                      placeholder="default 70"
                      value={editInfo.max_age}
                      onChange={(e) =>
                        setEditInfo({ ...editInfo, max_age: e.target.value })
                      }
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Leads below the vehicle minimum or above the age maximum are marked Not Billable.
                  Leave blank to use defaults (2 vehicles, under 70).
                </p>
              </div>
            )}
            {editInfo.roles.includes("telemarketer") && (
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-sm font-medium">Telemarketer goals</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ei-gcalls">Calls</Label>
                    <Input
                      id="ei-gcalls"
                      type="number"
                      min="0"
                      placeholder="0"
                      value={editInfo.goal_calls}
                      onChange={(e) =>
                        setEditInfo({ ...editInfo, goal_calls: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ei-gxfers">Transfers</Label>
                    <Input
                      id="ei-gxfers"
                      type="number"
                      min="0"
                      placeholder="0"
                      value={editInfo.goal_transfers}
                      onChange={(e) =>
                        setEditInfo({ ...editInfo, goal_transfers: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ei-gperiod">Period</Label>
                    <select
                      id="ei-gperiod"
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                      value={editInfo.goal_period}
                      onChange={(e) =>
                        setEditInfo({
                          ...editInfo,
                          goal_period: e.target.value as "" | "day" | "week" | "month",
                        })
                      }
                    >
                      <option value="">—</option>
                      <option value="day">Daily</option>
                      <option value="week">Weekly</option>
                      <option value="month">Monthly</option>
                    </select>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Targets shown on the telemarketer's My Performance page.
                </p>
              </div>
            )}
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Password</p>
                <Badge variant="outline" className="text-[10px]">
                  Hashed — original cannot be viewed
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Passwords are stored as one-way hashes, so the existing one can't be shown.
                You can set a new password (shown once below so you can share it), or email the
                user a self-serve reset link.
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="ei-newpass">New password</Label>
                <div className="flex gap-2">
                  <Input
                    id="ei-newpass"
                    type="text"
                    autoComplete="new-password"
                    placeholder="At least 8 characters"
                    value={pwInput}
                    onChange={(e) => setPwInput(e.target.value)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const chars =
                        "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%";
                      let out = "";
                      const arr = new Uint32Array(16);
                      (typeof crypto !== "undefined" ? crypto : window.crypto).getRandomValues(arr);
                      for (let i = 0; i < 16; i++) out += chars[arr[i] % chars.length];
                      setPwInput(out);
                    }}
                  >
                    Generate
                  </Button>
                </div>
              </div>
              {pwShown && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                  <div className="font-medium text-amber-900 dark:text-amber-200">
                    New password (shown once):
                  </div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="rounded bg-background px-2 py-1 font-mono text-sm">
                      {pwShown}
                    </code>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        navigator.clipboard?.writeText(pwShown);
                        toast.success("Copied to clipboard");
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => setPwM.mutate()}
                  disabled={setPwM.isPending || pwInput.trim().length < 8}
                >
                  Set password
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => sendResetM.mutate()}
                  disabled={sendResetM.isPending}
                >
                  Send reset email
                </Button>
              </div>
            </div>
          </div>
        )}
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => setEditInfo(null)}>Cancel</Button>
          <Button onClick={() => editInfoM.mutate()} disabled={editInfoM.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <Dialog open={!!newUser} onOpenChange={(o) => !o && setNewUser(null)}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>Add user</DialogTitle>
          <DialogDescription>
            Create a new account with email + password and assign roles. The user can change their password after signing in.
          </DialogDescription>
        </DialogHeader>
        {newUser && (
          <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
            <div className="space-y-1.5 rounded-md border p-3">
              <p className="text-sm font-medium">Roles</p>
              <div className="flex flex-wrap gap-3">
                {ALL_ROLES.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={newUser.roles.includes(r)}
                      onCheckedChange={() => toggleNewRole(r)}
                    />
                    {ROLE_LABELS[r]}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-email">Email</Label>
              <Input
                id="nu-email"
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-pass">Temporary password</Label>
              <Input
                id="nu-pass"
                type="text"
                autoComplete="new-password"
                placeholder="At least 8 characters"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-name">Full name</Label>
              <Input
                id="nu-name"
                value={newUser.full_name}
                onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nu-company">Company</Label>
              <Input
                id="nu-company"
                value={newUser.company_name}
                onChange={(e) => setNewUser({ ...newUser, company_name: e.target.value })}
              />
            </div>
            {newUser.roles.includes("vendor") && (
              <div className="space-y-1.5">
                <Label htmlFor="nu-rate">Lead rate ($ per lead)</Label>
                <Input
                  id="nu-rate"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={newUser.default_lead_rate}
                  onChange={(e) =>
                    setNewUser({ ...newUser, default_lead_rate: e.target.value })
                  }
                />
              </div>
            )}
          </div>
        )}
        <DialogFooter className="border-t px-6 py-4">
          <Button variant="outline" onClick={() => setNewUser(null)}>Cancel</Button>
          <Button onClick={() => createM.mutate()} disabled={createM.isPending}>
            Create user
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  );
}