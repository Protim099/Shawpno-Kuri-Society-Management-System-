"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { api, fdate } from "@/lib/api";
import { useLoad, useAction } from "@/lib/hooks";
import { useAuth } from "@/lib/providers";
import { Badge, Button, Card, Field, Input, Modal, PageTitle, Select, Table } from "@/components/ui";

export default function UsersPage() {
  const { data, reload } = useLoad<any[]>("/users", []);
  const { data: audit } = useLoad<any[]>("/audit-logs?limit=50", []);
  const { user } = useAuth(); const run = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "ACCOUNTANT" });
  const sa = user?.role === "SUPER_ADMIN";
  return (
    <>
      <PageTitle en="Users & Roles" bn="ব্যবহারকারী ও অনুমতি" action={<Button onClick={() => setOpen(true)}><Plus size={16} /> Add User</Button>} />
      <Card>
        <Table head={["Name", "Email", "Role", "Status", "Created", ""]} empty={!data?.length}>
          {data?.map((u) => (
            <tr key={u.id}><td>{u.name}</td><td>{u.email}</td>
              <td><Select className="!w-40 !py-1" value={u.role} disabled={u.id === user?.id} onChange={(e) => run(() => api(`/users/${u.id}`, { method: "PATCH", body: { role: e.target.value } }), "Role updated", reload)}>
                {["SUPER_ADMIN", "ADMIN", "ACCOUNTANT", "MEMBER"].filter((r) => sa || (r !== "SUPER_ADMIN" && r !== "ADMIN") || r === u.role).map((r) => <option key={r}>{r}</option>)}</Select></td>
              <td><Badge v={u.isActive ? "ACTIVE" : "INACTIVE"} /></td><td>{fdate(u.createdAt)}</td>
              <td>{u.id !== user?.id && <Button size="sm" variant="outline" onClick={() => run(() => api(`/users/${u.id}`, { method: "PATCH", body: { isActive: !u.isActive } }), "Updated", reload)}>{u.isActive ? "Disable" : "Enable"}</Button>}</td></tr>
          ))}
        </Table>
      </Card>
      <Card title="Recent Audit Log / অডিট লগ" className="mt-5">
        <Table head={["Time", "User", "Action", "Entity", "ID"]} empty={!audit?.length}>{audit?.map((a) => <tr key={a.id}><td>{String(a.createdAt).replace("T", " ").slice(0, 19)}</td><td>{a.user?.name ?? "—"}</td><td>{a.action}</td><td>{a.entity}</td><td>{a.entityId}</td></tr>)}</Table>
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Add User">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => api("/users", { body: f }), "User created", () => { setOpen(false); reload(); }); }}>
          <Field label="Name"><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Email"><Input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
          <Field label="Password (min 8)"><Input required type="password" minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <Field label="Role"><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{["ACCOUNTANT", "ADMIN", "SUPER_ADMIN"].filter((r) => sa || r === "ACCOUNTANT").map((r) => <option key={r}>{r}</option>)}</Select></Field>
          <div className="flex justify-end"><Button>Create</Button></div>
        </form>
      </Modal>
    </>
  );
}
