import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { useAuth } from "@/hooks/useAuth";
import { useEffectivePlan } from "@/hooks/useEffectivePlan";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Sparkles, Lock, Users, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export const LEAD_STATUSES = [
  { value: "new", label: "New" },
  { value: "reached", label: "Reached" },
  { value: "follow_up", label: "Follow Up" },
  { value: "converted", label: "Converted" },
  { value: "lost", label: "Lost" },
];

const UNASSIGNED = "__unassigned__";
const ALL = "__all__";

interface StaffOption {
  staff_user_id: string;
  staff_name: string | null;
  staff_email: string;
  whatsapp_number?: string | null;
}

interface LeadRow {
  id: string | null;
  phone_number: string;
  customer_name: string;
  assigned_to: string | null;
  status: string;
  inbound_count: number;
  has_order: boolean;
  last_time: string | null;
}

export default function Leads() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { effectiveUserId, isStaff, isGrowth, loading: planLoading } = useEffectivePlan();

  const [rows, setRows] = useState<LeadRow[]>([]);
  const [staff, setStaff] = useState<StaffOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [autoAssign, setAutoAssign] = useState(false);
  const [search, setSearch] = useState("");
  const [filterStaff, setFilterStaff] = useState<string>(ALL);
  const [filterStatus, setFilterStatus] = useState<string>(ALL);
  const [qualifiedOnly, setQualifiedOnly] = useState(false);

  const isOwner = !isStaff;

  const load = useCallback(async () => {
    if (!effectiveUserId || !isGrowth) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [orderRes, leadRes, staffRes, settingRes] = await Promise.all([
        supabase
          .from("orders")
          .select("customer_phone, whatsapp_phone")
          .eq("user_id", effectiveUserId),
        supabase
          .from("leads" as any)
          .select("id, phone_number, customer_name, assigned_to, status, inbound_count, updated_at")
          .eq("user_id", effectiveUserId)
          .order("updated_at", { ascending: false }),
        supabase
          .from("staff_accounts")
          .select("staff_user_id, staff_name, staff_email, whatsapp_number")
          .eq("owner_id", effectiveUserId)
          .eq("is_active", true),
        supabase
          .from("settings")
          .select("value")
          .eq("user_id", effectiveUserId)
          .eq("key", "leads_auto_assign")
          .maybeSingle(),
      ]);

      const staffList = (staffRes.data || []) as StaffOption[];
      setStaff(staffList);
      setAutoAssign(Boolean((settingRes.data?.value as any)?.enabled));

      const orderPhones = new Set<string>();
      (orderRes.data || []).forEach((o: any) => {
        if (o.customer_phone) orderPhones.add(String(o.customer_phone));
        if (o.whatsapp_phone) orderPhones.add(String(o.whatsapp_phone));
      });

      const built: LeadRow[] = ((leadRes.data as any[]) || []).map((l) => ({
        id: l.id,
        phone_number: l.phone_number,
        customer_name: l.customer_name || "Unknown",
        assigned_to: l.assigned_to ?? null,
        status: l.status || "new",
        inbound_count: l.inbound_count || 0,
        has_order: orderPhones.has(l.phone_number),
        last_time: l.updated_at || null,
      }));

      setRows(built);
    } catch (err: any) {
      toast({ title: "Error loading leads", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [effectiveUserId, isGrowth, toast]);

  useEffect(() => {
    if (!planLoading) load();
  }, [planLoading, load]);

  // Auto-assign unassigned leads in round-robin order (owner side)
  useEffect(() => {
    if (!isOwner || !autoAssign || loading || staff.length === 0) return;
    const unassigned = rows.filter((r) => !r.assigned_to && r.id);
    if (unassigned.length === 0) return;

    const counts = new Map<string, number>();
    staff.forEach((s) => counts.set(s.staff_user_id, 0));
    rows.forEach((r) => {
      if (r.assigned_to && counts.has(r.assigned_to)) {
        counts.set(r.assigned_to, (counts.get(r.assigned_to) || 0) + 1);
      }
    });

    (async () => {
      const updates: { id: string; staffId: string }[] = [];
      for (const lead of unassigned) {
        let target = staff[0].staff_user_id;
        let min = Infinity;
        for (const s of staff) {
          const c = counts.get(s.staff_user_id) || 0;
          if (c < min) {
            min = c;
            target = s.staff_user_id;
          }
        }
        counts.set(target, (counts.get(target) || 0) + 1);
        updates.push({ id: lead.id as string, staffId: target });
      }
      await Promise.all(
        updates.map((u) =>
          (supabase.from("leads" as any) as any)
            .update({ assigned_to: u.staffId })
            .eq("id", u.id)
        )
      );
      updates.forEach((u) => {
        const lead = rows.find((r) => r.id === u.id);
        if (lead) notifyStaffAssignment(u.staffId, lead);
      });
      setRows((prev) =>
        prev.map((r) => {
          const u = updates.find((x) => x.id === r.id);
          return u ? { ...r, assigned_to: u.staffId } : r;
        })
      );
    })();
  }, [autoAssign, rows, staff, isOwner, loading]);

  const toggleAutoAssign = async (checked: boolean) => {
    if (!effectiveUserId) return;
    setAutoAssign(checked);
    const { error } = await supabase
      .from("settings")
      .upsert(
        { user_id: effectiveUserId, key: "leads_auto_assign", value: { enabled: checked } },
        { onConflict: "user_id,key" }
      );
    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: checked ? "Auto-assign enabled" : "Auto-assign disabled" });
  };

  // Notify the staff member on WhatsApp that a customer was assigned to them
  const notifyStaffAssignment = async (staffUserId: string, row: LeadRow) => {
    try {
      const member = staff.find((s) => s.staff_user_id === staffUserId);
      const number = member?.whatsapp_number?.trim();
      if (!number || !effectiveUserId) return;

      const { data: sessionData } = await supabase
        .from("user_wsender_sessions" as any)
        .select("session_api_key, session_id")
        .eq("user_id", effectiveUserId)
        .limit(1)
        .maybeSingle();

      const displayPhone = String(row.phone_number || "").split("@")[0];
      const message = `👤 NEW CUSTOMER ASSIGNED\n\nName: ${row.customer_name || "Unknown"}\nContact: ${displayPhone}\n\nPlease follow up with this customer.`;

      await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-whatsapp`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: number,
          message,
          sessionApiKey:
            (sessionData as any)?.session_api_key || (sessionData as any)?.session_id,
        }),
      });
    } catch (e) {
      console.error("Staff assignment notification failed", e);
    }
  };

  const updateLead = async (row: LeadRow, patch: Record<string, any>) => {
    if (!row.id) return;
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
    const { error } = await (supabase.from("leads" as any) as any)
      .update(patch)
      .eq("id", row.id);
    if (error) {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
      load();
      return;
    }
    if (
      Object.prototype.hasOwnProperty.call(patch, "assigned_to") &&
      patch.assigned_to &&
      patch.assigned_to !== row.assigned_to
    ) {
      notifyStaffAssignment(patch.assigned_to, { ...row, ...patch });
    }
  };

  const staffName = (id: string | null) => {
    if (!id) return "Unassigned";
    const s = staff.find((x) => x.staff_user_id === id);
    return s?.staff_name || s?.staff_email || "Staff";
  };

  const isQualified = (r: LeadRow) => r.inbound_count >= 6 || r.has_order;

  const visibleRows = useMemo(() => {
    let list = rows;
    if (isStaff && user) list = list.filter((r) => r.assigned_to === user.id);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (r) =>
          r.phone_number.toLowerCase().includes(q) ||
          r.customer_name.toLowerCase().includes(q)
      );
    }
    if (isOwner) {
      if (filterStaff !== ALL) {
        list = list.filter((r) =>
          filterStaff === UNASSIGNED ? !r.assigned_to : r.assigned_to === filterStaff
        );
      }
      if (filterStatus !== ALL) list = list.filter((r) => r.status === filterStatus);
      if (qualifiedOnly) list = list.filter(isQualified);
    }
    return list;
  }, [rows, isStaff, user, search, isOwner, filterStaff, filterStatus, qualifiedOnly]);

  if (planLoading) {
    return (
      <DashboardLayout>
        <p className="text-muted-foreground">Loading...</p>
      </DashboardLayout>
    );
  }

  if (!isGrowth) {
    return (
      <DashboardLayout>
        <div className="max-w-xl mx-auto mt-10">
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-2">
                <Lock className="h-6 w-6 text-muted-foreground" />
              </div>
              <CardTitle>Leads is a Growth plan feature</CardTitle>
              <CardDescription>
                Upgrade to the Growth plan to track customers, assign leads to your staff and
                follow up on qualified buyers.
              </CardDescription>
            </CardHeader>
            <CardContent className="text-center">
              <Button onClick={() => navigate("/dashboard/settings")}>View plan details</Button>
            </CardContent>
          </Card>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Leads</h1>
            <p className="text-muted-foreground text-sm">
              {isStaff
                ? "Leads assigned to you"
                : "Customers who have chatted with your WhatsApp bot"}
            </p>
          </div>
          {isOwner && (
            <div className="flex items-center gap-2 rounded-lg border p-3">
              <Switch
                id="auto-assign"
                checked={autoAssign}
                onCheckedChange={toggleAutoAssign}
                disabled={staff.length === 0}
              />
              <Label htmlFor="auto-assign" className="text-sm cursor-pointer">
                Assign automatically
              </Label>
            </div>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search name or number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {isOwner && (
            <>
              <Select value={filterStaff} onValueChange={setFilterStaff}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="All staff" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All staff</SelectItem>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s.staff_user_id} value={s.staff_user_id}>
                      {s.staff_name || s.staff_email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All statuses</SelectItem>
                  {LEAD_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant={qualifiedOnly ? "default" : "outline"}
                onClick={() => setQualifiedOnly((v) => !v)}
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Qualified only
              </Button>
            </>
          )}
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Users className="h-5 w-5" />
              {visibleRows.length} lead{visibleRows.length === 1 ? "" : "s"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : visibleRows.length === 0 ? (
              <p className="text-muted-foreground">No leads to show yet.</p>
            ) : (
              <div className="space-y-3">
                {visibleRows.map((row) => {
                  const qualified = isQualified(row);
                  return (
                    <div
                      key={row.phone_number}
                      className={cn(
                        "flex flex-col lg:flex-row lg:items-center gap-3 p-3 rounded-lg border",
                        qualified && "border-primary/50 bg-primary/5"
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-medium truncate">{row.customer_name}</p>
                          {qualified && (
                            <Badge className="text-[10px]">
                              <Sparkles className="h-3 w-3 mr-1" />
                              Qualified
                            </Badge>
                          )}
                          {row.has_order && (
                            <Badge variant="secondary" className="text-[10px]">
                              Ordered
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {row.phone_number} · {row.inbound_count} message
                          {row.inbound_count === 1 ? "" : "s"}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {isOwner ? (
                          <Select
                            value={row.assigned_to || UNASSIGNED}
                            onValueChange={(v) =>
                              updateLead(row, { assigned_to: v === UNASSIGNED ? null : v })
                            }
                          >
                            <SelectTrigger className="w-[170px]">
                              <SelectValue placeholder="Assign to" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                              {staff.map((s) => (
                                <SelectItem key={s.staff_user_id} value={s.staff_user_id}>
                                  {s.staff_name || s.staff_email}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge variant="outline">{staffName(row.assigned_to)}</Badge>
                        )}

                        <Select
                          value={row.status}
                          onValueChange={(v) => updateLead(row, { status: v })}
                        >
                          <SelectTrigger className="w-[140px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LEAD_STATUSES.map((s) => (
                              <SelectItem key={s.value} value={s.value}>
                                {s.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            navigate(
                              `/dashboard/conversations?phone=${encodeURIComponent(
                                row.phone_number
                              )}`
                            )
                          }
                        >
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Chat
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
