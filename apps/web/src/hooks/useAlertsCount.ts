import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export function useOpenAlertsCount() {
  return useQuery({
    queryKey: ["alerts", "count"],
    queryFn: async () => {
      const { data } = await api.get("/alerts", { params: { status: "ABERTO", pageSize: 1 } });
      return data.countAbertos as number;
    },
    refetchInterval: 60_000,
  });
}

export function useUnreadNotificationsCount() {
  return useQuery({
    queryKey: ["notifications", "unread-count"],
    queryFn: async () => {
      const { data } = await api.get("/notifications", { params: { pageSize: 1 } });
      return data.unreadCount as number;
    },
    refetchInterval: 60_000,
  });
}
