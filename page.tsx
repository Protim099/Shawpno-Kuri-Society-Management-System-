"use client";
import { useParams } from "next/navigation";
import { useLoad } from "@/lib/hooks";
import { PageTitle } from "@/components/ui";
import { MemberProfile } from "@/components/MemberProfile";

export default function MemberDetail() {
  const { id } = useParams<{ id: string }>();
  const { data } = useLoad<any>(`/members/${id}`);
  return (<><PageTitle en="Member Profile" bn="সদস্য প্রোফাইল" />{data ? <MemberProfile p={data} /> : <p className="text-slate-400">Loading...</p>}</>);
}
