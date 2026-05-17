import { Ionicons } from "@expo/vector-icons";
import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View
} from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import {
  API_URL,
  assignFlow,
  createConvNote,
  createOutboundConversation,
  fetchAgentProfiles,
  fetchApprovedTemplates,
  fetchContactByConversation,
  fetchConversation,
  fetchConversationLabels,
  fetchConvMessages,
  fetchConvNotes,
  fetchConvPage,
  fetchLabels,
  fetchPublishedFlows,
  listAgentNotifications,
  listCannedResponses,
  listInboxContacts,
  markAllNotificationsRead,
  markNotificationRead,
  patchAiMode,
  patchAssignAgent,
  patchPriority,
  patchStatus,
  postMarkRead,
  postMessage,
  postRetry,
  putLabels,
  registerPushToken,
  revokePushToken,
  sendPhoneLoginOtp,
  sendTemplate,
  toWsBase,
  uploadConversationMedia,
  verifyPhoneLoginOtp
} from "./src/api";
import type {
  AgentNotification,
  CannedResponse,
  ContactRecord,
  Conversation,
  ConversationMessage,
  ConvFilters,
  ConvFolder,
  ConvPriority,
  ConvStatus,
  InboxContact,
  Label,
  MessageTemplate,
  User
} from "./src/types";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true
  })
});

const queryClient = new QueryClient();
const TOKEN_KEY = "wagen-mobile-token";
const PUSH_TOKEN_KEY = "wagen-mobile-push-token";
const WS_BASE = toWsBase(API_URL);

const DEFAULT_FILTERS: ConvFilters = {
  stage: "all",
  channel: "all",
  aiMode: "all",
  assignment: "all",
  labelId: "all",
  leadKind: "all",
  priority: "all",
  tags: []
};

function uid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const rand = Math.floor(Math.random() * 16);
    const value = char === "x" ? rand : (rand & 0x3) | 0x8;
    return value.toString(16);
  });
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { day: "2-digit", month: "short" });
}

function contactTitle(conversation: Conversation): string {
  return conversation.contact_name || conversation.phone_number || "Unknown";
}

function shortText(value: string | null | undefined, max = 90): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function useSession() {
  const [token, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    SecureStore.getItemAsync(TOKEN_KEY)
      .then((stored) => {
        if (stored) setTokenState(stored);
      })
      .finally(() => setBooting(false));
  }, []);

  const setToken = useCallback(async (nextToken: string | null, nextUser?: User | null) => {
    setTokenState(nextToken);
    setUser(nextUser ?? null);
    if (nextToken) {
      await SecureStore.setItemAsync(TOKEN_KEY, nextToken);
    } else {
      await SecureStore.deleteItemAsync(TOKEN_KEY);
    }
  }, []);

  return { token, user, setUser, setToken, booting };
}

function usePushRegistration(token: string | null) {
  const [expoPushToken, setExpoPushToken] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    const authToken = token;
    let cancelled = false;

    async function register() {
      if (!Device.isDevice) return;
      const existing = await Notifications.getPermissionsAsync();
      const finalStatus = existing.status === "granted"
        ? existing
        : await Notifications.requestPermissionsAsync();
      if (finalStatus.status !== "granted") return;

      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("messages", {
          name: "Messages",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#16a34a"
        });
      }

      const projectId =
        Constants.easConfig?.projectId ||
        (Constants.expoConfig?.extra?.eas as { projectId?: string } | undefined)?.projectId;
      const push = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
      if (cancelled) return;
      setExpoPushToken(push.data);
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, push.data);
      await registerPushToken(authToken, {
        expoPushToken: push.data,
        platform: Platform.OS === "android" || Platform.OS === "ios" ? Platform.OS : "unknown",
        deviceName: Device.deviceName,
        appVersion: Constants.expoConfig?.version ?? null
      });
    }

    register().catch((error) => {
      console.warn("Push registration failed", error);
    });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return expoPushToken;
}

function useRealtime(
  token: string | null,
  activeConversationId: string | null,
  onOpenConversation: (id: string) => void,
  onOpenNotifications: () => void
) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!token) return;
    const authToken = token;
    let ws: WebSocket | null = null;
    let retryMs = 1000;
    let closed = false;

    function connect() {
      if (closed) return;
      ws = new WebSocket(`${WS_BASE}/ws?token=${encodeURIComponent(authToken)}`);
      ws.onopen = () => {
        retryMs = 1000;
      };
      ws.onmessage = (event) => {
        let envelope: { event?: string; data?: unknown };
        try {
          envelope = JSON.parse(String(event.data)) as { event?: string; data?: unknown };
        } catch {
          return;
        }
        if (envelope.event === "message.created") {
          const data = envelope.data as { conversationId: string; message: ConversationMessage };
          qc.setQueryData<{ items: ConversationMessage[]; hasMore: boolean; nextCursor: string | null }>(
            ["messages", data.conversationId],
            (current) => {
              const items = current?.items ?? [];
              if (items.some((item) => item.id === data.message.id || item.echo_id === data.message.echo_id)) {
                return current ?? { items, hasMore: false, nextCursor: null };
              }
              return { items: [...items, data.message], hasMore: current?.hasMore ?? false, nextCursor: current?.nextCursor ?? null };
            }
          );
          void qc.invalidateQueries({ queryKey: ["conversations"] });
        }
        if (
          envelope.event === "conversation.updated" ||
          envelope.event === "conversation.created" ||
          envelope.event === "conversation.status_changed" ||
          envelope.event === "conversation.priority_changed" ||
          envelope.event === "conversation.label_changed" ||
          envelope.event === "conversation.assigned"
        ) {
          void qc.invalidateQueries({ queryKey: ["conversations"] });
          if (activeConversationId) {
            void qc.invalidateQueries({ queryKey: ["conversation", activeConversationId] });
          }
        }
        if (envelope.event === "agent.notification") {
          void qc.invalidateQueries({ queryKey: ["notifications"] });
        }
      };
      ws.onclose = () => {
        if (closed) return;
        setTimeout(connect, retryMs);
        retryMs = Math.min(retryMs * 2, 30000);
      };
      ws.onerror = () => ws?.close();
    }

    connect();
    const ping = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send("ping");
    }, 25000);

    return () => {
      closed = true;
      clearInterval(ping);
      ws?.close();
    };
  }, [activeConversationId, onOpenConversation, qc, token]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { conversationId?: string };
      if (data.conversationId) {
        onOpenConversation(data.conversationId);
      } else {
        onOpenNotifications();
      }
    });
    return () => sub.remove();
  }, [onOpenConversation, onOpenNotifications]);
}

function AppShell() {
  const session = useSession();

  if (session.booting) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator color="#16a34a" />
      </SafeAreaView>
    );
  }

  return session.token ? (
    <InboxApp session={session} />
  ) : (
    <OtpLogin onLogin={(token, user) => session.setToken(token, user)} />
  );
}

function OtpLogin({ onLogin }: { onLogin: (token: string, user: User) => void }) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [otp, setOtp] = useState("");
  const [sentPhone, setSentPhone] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  const sendMutation = useMutation({
    mutationFn: () => sendPhoneLoginOtp(phoneNumber),
    onSuccess: (result) => {
      setSentPhone(result.phoneNumber);
      setDevCode(result.devCode ?? null);
    },
    onError: (error) => Alert.alert("OTP", (error as Error).message)
  });

  const verifyMutation = useMutation({
    mutationFn: () => verifyPhoneLoginOtp(sentPhone ?? phoneNumber, otp),
    onSuccess: (result) => onLogin(result.token, result.user),
    onError: (error) => Alert.alert("OTP", (error as Error).message)
  });

  return (
    <SafeAreaView style={styles.authRoot}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.authBrand}>
        <View style={styles.logoMark}>
          <Text style={styles.logoMarkText}>W</Text>
        </View>
        <Text style={styles.authTitle}>WAgen Agent</Text>
        <Text style={styles.authSubtitle}>Sign in with your verified mobile number.</Text>
      </View>
      <View style={styles.authPanel}>
        <Text style={styles.fieldLabel}>Mobile number</Text>
        <TextInput
          value={phoneNumber}
          onChangeText={setPhoneNumber}
          keyboardType="phone-pad"
          placeholder="+91XXXXXXXXXX"
          placeholderTextColor="#94a3b8"
          style={styles.input}
          editable={!sendMutation.isPending && !verifyMutation.isPending}
        />
        {sentPhone && (
          <>
            <Text style={styles.fieldLabel}>OTP</Text>
            <TextInput
              value={otp}
              onChangeText={(value) => setOtp(value.replace(/\D/g, "").slice(0, 6))}
              keyboardType="number-pad"
              placeholder="6-digit code"
              placeholderTextColor="#94a3b8"
              style={styles.input}
              maxLength={6}
            />
          </>
        )}
        {devCode && <Text style={styles.devCode}>Dev OTP: {devCode}</Text>}
        <Pressable
          style={[styles.primaryButton, (sendMutation.isPending || verifyMutation.isPending) && styles.disabledButton]}
          onPress={() => {
            if (!sentPhone) sendMutation.mutate();
            else verifyMutation.mutate();
          }}
          disabled={sendMutation.isPending || verifyMutation.isPending}
        >
          {sendMutation.isPending || verifyMutation.isPending ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.primaryButtonText}>{sentPhone ? "Verify and open inbox" : "Send OTP"}</Text>
          )}
        </Pressable>
        {sentPhone && (
          <Pressable
            style={styles.textButton}
            onPress={() => {
              setOtp("");
              sendMutation.mutate();
            }}
          >
            <Text style={styles.textButtonText}>Resend code</Text>
          </Pressable>
        )}
      </View>
      <Text style={styles.authFoot}>API: {API_URL}</Text>
    </SafeAreaView>
  );
}

function InboxApp({ session }: { session: ReturnType<typeof useSession> }) {
  const token = session.token!;
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const pushToken = usePushRegistration(token);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [screen, setScreen] = useState<"list" | "chat" | "details" | "notifications">("list");
  const [folder, setFolder] = useState<ConvFolder>("all");
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<ConvFilters>(DEFAULT_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const openConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    setScreen("chat");
  }, []);
  const openNotifications = useCallback(() => {
    setScreen("notifications");
  }, []);
  useRealtime(token, activeConversationId, openConversation, openNotifications);

  const conversationsQuery = useQuery({
    queryKey: ["conversations", folder, q, filters],
    queryFn: () => fetchConvPage(token, { folder, q, filters, limit: 80 })
  });
  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listAgentNotifications(token, { limit: 80 })
  });

  const conversations = conversationsQuery.data?.items ?? [];
  const activeConversation = conversations.find((item) => item.id === activeConversationId) ?? null;
  const unreadNotifications = notificationsQuery.data?.unreadCount ?? 0;

  const logout = useCallback(async () => {
    if (pushToken) {
      await revokePushToken(token, pushToken).catch(() => undefined);
      await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY);
    }
    queryClient.clear();
    await session.setToken(null);
  }, [pushToken, session, token]);

  return (
    <SafeAreaView style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar barStyle="dark-content" />
      <TopBar
        user={session.user}
        screen={screen}
        activeConversation={activeConversation}
        unreadNotifications={unreadNotifications}
        onBack={() => setScreen("list")}
        onDetails={() => setScreen("details")}
        onNotifications={() => setScreen("notifications")}
        onLogout={logout}
      />
      {screen === "list" && (
        <ConversationListScreen
          token={token}
          conversations={conversations}
          loading={conversationsQuery.isLoading}
          refreshing={conversationsQuery.isFetching}
          folder={folder}
          q={q}
          filters={filters}
          showFilters={showFilters}
          onChangeFolder={setFolder}
          onChangeQ={setQ}
          onChangeFilters={setFilters}
          onToggleFilters={() => setShowFilters((value) => !value)}
          onRefresh={() => conversationsQuery.refetch()}
          onOpenConversation={openConversation}
          onNew={() => setShowNew(true)}
        />
      )}
      {screen === "chat" && activeConversationId && (
        <ChatScreen
          token={token}
          conversationId={activeConversationId}
          onDetails={() => setScreen("details")}
        />
      )}
      {screen === "details" && activeConversationId && (
        <DetailsScreen
          token={token}
          conversationId={activeConversationId}
          onChanged={() => {
            void qc.invalidateQueries({ queryKey: ["conversations"] });
            void qc.invalidateQueries({ queryKey: ["conversation", activeConversationId] });
          }}
        />
      )}
      {screen === "notifications" && (
        <NotificationsScreen
          token={token}
          notifications={notificationsQuery.data?.notifications ?? []}
          unreadCount={unreadNotifications}
          refreshing={notificationsQuery.isFetching}
          onRefresh={() => notificationsQuery.refetch()}
          onOpenConversation={(id) => {
            openConversation(id);
          }}
        />
      )}
      <NewConversationModal
        visible={showNew}
        token={token}
        onClose={() => setShowNew(false)}
        onCreated={(id) => {
          setShowNew(false);
          openConversation(id);
        }}
      />
    </SafeAreaView>
  );
}

function TopBar({
  user,
  screen,
  activeConversation,
  unreadNotifications,
  onBack,
  onDetails,
  onNotifications,
  onLogout
}: {
  user: User | null;
  screen: string;
  activeConversation: Conversation | null;
  unreadNotifications: number;
  onBack: () => void;
  onDetails: () => void;
  onNotifications: () => void;
  onLogout: () => void;
}) {
  const title = screen === "chat" && activeConversation
    ? contactTitle(activeConversation)
    : screen === "details"
      ? "Details"
      : screen === "notifications"
        ? "Notifications"
        : "Inbox";
  return (
    <View style={styles.topBar}>
      {screen !== "list" ? (
        <IconButton name="chevron-back" onPress={onBack} />
      ) : (
        <View style={styles.logoSmall}>
          <Text style={styles.logoSmallText}>W</Text>
        </View>
      )}
      <View style={styles.topBarTitleWrap}>
        <Text numberOfLines={1} style={styles.topBarTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.topBarSub}>{screen === "list" ? user?.name ?? "Agent" : activeConversation?.channel_type ?? ""}</Text>
      </View>
      {screen === "chat" && <IconButton name="information-circle-outline" onPress={onDetails} />}
      {screen === "list" && (
        <>
          <Pressable style={styles.bellButton} onPress={onNotifications}>
            <Ionicons name="notifications-outline" size={20} color="#0f172a" />
            {unreadNotifications > 0 && <Text style={styles.bellBadge}>{Math.min(unreadNotifications, 99)}</Text>}
          </Pressable>
          <IconButton name="log-out-outline" onPress={onLogout} />
        </>
      )}
    </View>
  );
}

function ConversationListScreen({
  token,
  conversations,
  loading,
  refreshing,
  folder,
  q,
  filters,
  showFilters,
  onChangeFolder,
  onChangeQ,
  onChangeFilters,
  onToggleFilters,
  onRefresh,
  onOpenConversation,
  onNew
}: {
  token: string;
  conversations: Conversation[];
  loading: boolean;
  refreshing: boolean;
  folder: ConvFolder;
  q: string;
  filters: ConvFilters;
  showFilters: boolean;
  onChangeFolder: (folder: ConvFolder) => void;
  onChangeQ: (q: string) => void;
  onChangeFilters: (filters: ConvFilters) => void;
  onToggleFilters: () => void;
  onRefresh: () => void;
  onOpenConversation: (id: string) => void;
  onNew: () => void;
}) {
  const labelsQuery = useQuery({ queryKey: ["labels"], queryFn: () => fetchLabels(token) });
  const folders: ConvFolder[] = ["all", "pending", "open", "resolved", "snoozed"];

  return (
    <View style={styles.screen}>
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color="#64748b" />
          <TextInput
            value={q}
            onChangeText={onChangeQ}
            placeholder="Search chats"
            placeholderTextColor="#94a3b8"
            style={styles.searchInput}
          />
        </View>
        <IconButton name="options-outline" onPress={onToggleFilters} active={showFilters} />
        <IconButton name="create-outline" onPress={onNew} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.folderTabs}>
        {folders.map((item) => (
          <Chip key={item} label={item} active={folder === item} onPress={() => onChangeFolder(item)} />
        ))}
      </ScrollView>
      {showFilters && (
        <FilterPanel
          filters={filters}
          labels={labelsQuery.data?.labels ?? []}
          onChange={onChangeFilters}
        />
      )}
      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color="#16a34a" />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <ConversationRow conversation={item} onPress={() => onOpenConversation(item.id)} />}
          ListEmptyComponent={<EmptyState title="No conversations" detail="Matched chats will appear here." />}
        />
      )}
    </View>
  );
}

function FilterPanel({ filters, labels, onChange }: { filters: ConvFilters; labels: Label[]; onChange: (filters: ConvFilters) => void }) {
  return (
    <View style={styles.filterPanel}>
      <OptionGroup title="Channel" value={filters.channel} options={["all", "api", "qr", "web"]} onChange={(channel) => onChange({ ...filters, channel })} />
      <OptionGroup title="AI mode" value={filters.aiMode} options={["all", "ai", "human"]} onChange={(aiMode) => onChange({ ...filters, aiMode })} />
      <OptionGroup title="Assignment" value={filters.assignment} options={["all", "assigned", "unassigned"]} onChange={(assignment) => onChange({ ...filters, assignment })} />
      <OptionGroup title="Priority" value={filters.priority} options={["all", "none", "low", "medium", "high", "urgent"]} onChange={(priority) => onChange({ ...filters, priority })} />
      <OptionGroup title="Stage" value={filters.stage} options={["all", "hot", "warm", "cold"]} onChange={(stage) => onChange({ ...filters, stage })} />
      <OptionGroup title="Kind" value={filters.leadKind} options={["all", "lead", "feedback", "complaint", "other"]} onChange={(leadKind) => onChange({ ...filters, leadKind })} />
      {labels.length > 0 && (
        <View style={styles.optionGroup}>
          <Text style={styles.optionTitle}>Label</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionChips}>
            <Chip label="all" active={filters.labelId === "all"} onPress={() => onChange({ ...filters, labelId: "all" })} />
            {labels.map((label) => (
              <Chip key={label.id} label={label.name} active={filters.labelId === label.id} onPress={() => onChange({ ...filters, labelId: label.id })} />
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function OptionGroup({ title, value, options, onChange }: { title: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <View style={styles.optionGroup}>
      <Text style={styles.optionTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.optionChips}>
        {options.map((option) => <Chip key={option} label={option} active={value === option} onPress={() => onChange(option)} />)}
      </ScrollView>
    </View>
  );
}

function ConversationRow({ conversation, onPress }: { conversation: Conversation; onPress: () => void }) {
  const priorityColor = priorityColors[conversation.priority] ?? "#94a3b8";
  return (
    <Pressable style={styles.convRow} onPress={onPress}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{contactTitle(conversation).slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.convMiddle}>
        <View style={styles.rowBetween}>
          <Text numberOfLines={1} style={styles.convTitle}>{contactTitle(conversation)}</Text>
          <Text style={styles.convTime}>{formatTime(conversation.last_message_at)}</Text>
        </View>
        <Text numberOfLines={2} style={styles.convMessage}>{shortText(conversation.last_message, 96)}</Text>
        <View style={styles.convMeta}>
          <Badge label={conversation.channel_type} tone="neutral" />
          <Badge label={conversation.status} tone={conversation.status === "pending" ? "warning" : conversation.status === "resolved" ? "success" : "neutral"} />
          <View style={[styles.priorityDot, { backgroundColor: priorityColor }]} />
          <Text style={styles.metaText}>{conversation.lead_kind}</Text>
        </View>
      </View>
      {conversation.unread_count > 0 && <Text style={styles.unreadBadge}>{Math.min(conversation.unread_count, 99)}</Text>}
    </Pressable>
  );
}

function ChatScreen({ token, conversationId, onDetails }: { token: string; conversationId: string; onDetails: () => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [tool, setTool] = useState<"none" | "canned" | "templates" | "note">("none");
  const [noteText, setNoteText] = useState("");
  const listRef = useRef<FlatList<ConversationMessage>>(null);

  const conversationQuery = useQuery({ queryKey: ["conversation", conversationId], queryFn: () => fetchConversation(token, conversationId) });
  const messagesQuery = useQuery({ queryKey: ["messages", conversationId], queryFn: () => fetchConvMessages(token, conversationId) });
  const cannedQuery = useQuery({ queryKey: ["canned"], queryFn: () => listCannedResponses(token) });
  const templatesQuery = useQuery({
    queryKey: ["templates", conversationQuery.data?.conversation.channel_linked_number],
    queryFn: () => fetchApprovedTemplates(token, conversationQuery.data?.conversation.channel_linked_number),
    enabled: Boolean(conversationQuery.data)
  });

  useEffect(() => {
    void postMarkRead(token, conversationId).then(() => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["notifications"] });
    }).catch(() => undefined);
  }, [conversationId, qc, token]);

  useEffect(() => {
    if ((messagesQuery.data?.items.length ?? 0) > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 120);
    }
  }, [messagesQuery.data?.items.length]);

  const sendMutation = useMutation({
    mutationFn: (payload: { text?: string; mediaUrl?: string | null; mediaMimeType?: string | null }) =>
      postMessage(token, conversationId, { ...payload, echoId: uid() }),
    onSuccess: () => {
      setText("");
      void qc.invalidateQueries({ queryKey: ["messages", conversationId] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
    },
    onError: (error) => Alert.alert("Message", (error as Error).message)
  });

  const noteMutation = useMutation({
    mutationFn: () => createConvNote(token, conversationId, noteText),
    onSuccess: () => {
      setNoteText("");
      setTool("none");
      void qc.invalidateQueries({ queryKey: ["notes", conversationId] });
    },
    onError: (error) => Alert.alert("Note", (error as Error).message)
  });

  const messages = messagesQuery.data?.items ?? [];

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.threadHeader}>
        <View>
          <Text style={styles.threadTitle}>{contactTitle(conversationQuery.data?.conversation ?? ({ phone_number: "" } as Conversation))}</Text>
          <Text style={styles.threadSub}>
            {conversationQuery.data?.conversation.status ?? "open"} - {conversationQuery.data?.conversation.channel_type ?? ""}
          </Text>
        </View>
        <IconButton name="information-circle-outline" onPress={onDetails} />
      </View>
      {messagesQuery.isLoading ? (
        <View style={styles.centerFill}><ActivityIndicator color="#16a34a" /></View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.messagesContent}
          renderItem={({ item }) => <MessageBubble token={token} message={item} onRetry={() => postRetry(token, conversationId, item.id).then(() => qc.invalidateQueries({ queryKey: ["messages", conversationId] }))} />}
          ListEmptyComponent={<EmptyState title="No messages yet" detail="Replies will appear here." />}
        />
      )}
      {tool === "canned" && <ToolPanel title="Canned responses" items={(cannedQuery.data?.cannedResponses ?? []).map((item) => ({ id: item.id, label: item.name, detail: item.content, value: item }))} onPick={(item) => { setText((item.value as CannedResponse).content); setTool("none"); }} onClose={() => setTool("none")} />}
      {tool === "templates" && <ToolPanel title="Templates" items={(templatesQuery.data ?? []).map((item) => ({ id: item.id, label: item.name, detail: `${item.category} - ${item.language}`, value: item }))} onPick={(item) => { const template = item.value as MessageTemplate; sendTemplate(token, conversationId, template.id).then(() => qc.invalidateQueries({ queryKey: ["messages", conversationId] })).catch((error) => Alert.alert("Template", (error as Error).message)); setTool("none"); }} onClose={() => setTool("none")} />}
      {tool === "note" && (
        <View style={styles.notePanel}>
          <TextInput value={noteText} onChangeText={setNoteText} placeholder="Private note" placeholderTextColor="#94a3b8" multiline style={styles.noteInput} />
          <Pressable style={styles.primarySmall} onPress={() => noteMutation.mutate()} disabled={!noteText.trim() || noteMutation.isPending}>
            <Text style={styles.primarySmallText}>Save note</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.compose}>
        <IconButton name="add-circle-outline" onPress={() => setTool(tool === "canned" ? "none" : "canned")} />
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Type a message"
          placeholderTextColor="#94a3b8"
          multiline
          style={styles.composeInput}
        />
        <IconButton name="document-attach-outline" onPress={async () => {
          const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
          if (!picked.canceled) {
            const file = picked.assets[0];
            const uploaded = await uploadConversationMedia(token, conversationId, { uri: file.uri, name: file.name, mimeType: file.mimeType });
            sendMutation.mutate({ text: file.name, mediaUrl: uploaded.url, mediaMimeType: uploaded.mimeType });
          }
        }} />
        <IconButton name="image-outline" onPress={async () => {
          const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.85 });
          if (!picked.canceled) {
            const asset = picked.assets[0];
            const name = asset.fileName || `image-${Date.now()}.jpg`;
            const uploaded = await uploadConversationMedia(token, conversationId, { uri: asset.uri, name, mimeType: asset.mimeType });
            sendMutation.mutate({ text: name, mediaUrl: uploaded.url, mediaMimeType: uploaded.mimeType });
          }
        }} />
        <IconButton name="chatbox-ellipses-outline" onPress={() => setTool(tool === "templates" ? "none" : "templates")} />
        <IconButton name="lock-closed-outline" onPress={() => setTool(tool === "note" ? "none" : "note")} />
        <Pressable style={[styles.sendButton, !text.trim() && styles.disabledButton]} disabled={!text.trim() || sendMutation.isPending} onPress={() => sendMutation.mutate({ text })}>
          <Ionicons name="send" size={18} color="#ffffff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function ToolPanel({ title, items, onPick, onClose }: { title: string; items: Array<{ id: string; label: string; detail: string; value: unknown }>; onPick: (item: { value: unknown }) => void; onClose: () => void }) {
  return (
    <View style={styles.toolPanel}>
      <View style={styles.rowBetween}>
        <Text style={styles.panelTitle}>{title}</Text>
        <IconButton name="close" onPress={onClose} />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolItems}>
        {items.map((item) => (
          <Pressable key={item.id} style={styles.toolItem} onPress={() => onPick(item)}>
            <Text numberOfLines={1} style={styles.toolLabel}>{item.label}</Text>
            <Text numberOfLines={2} style={styles.toolDetail}>{item.detail}</Text>
          </Pressable>
        ))}
        {items.length === 0 && <Text style={styles.emptyInline}>Nothing available</Text>}
      </ScrollView>
    </View>
  );
}

function MessageBubble({ token, message, onRetry }: { token: string; message: ConversationMessage; onRetry: () => void }) {
  const outbound = message.direction === "outbound";
  const isFailed = outbound && message.delivery_status === "failed";
  return (
    <View style={[styles.messageWrap, outbound ? styles.messageWrapOutbound : styles.messageWrapInbound]}>
      <View style={[styles.messageBubble, outbound ? styles.outboundBubble : styles.inboundBubble]}>
        {message.media_url && (
          <Text style={styles.mediaText}>{message.content_type === "image" ? "Image" : "Attachment"} - {shortText(message.media_url, 42)}</Text>
        )}
        <Text style={[styles.messageText, outbound && styles.outboundText]}>{message.message_text}</Text>
        <View style={styles.messageMetaRow}>
          <Text style={[styles.messageMeta, outbound && styles.outboundMeta]}>{formatTime(message.created_at)}</Text>
          {outbound && <Text style={[styles.messageMeta, styles.outboundMeta]}>{message.delivery_status}</Text>}
        </View>
        {isFailed && (
          <Pressable style={styles.retryButton} onPress={onRetry}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function DetailsScreen({ token, conversationId, onChanged }: { token: string; conversationId: string; onChanged: () => void }) {
  const qc = useQueryClient();
  const conversationQuery = useQuery({ queryKey: ["conversation", conversationId], queryFn: () => fetchConversation(token, conversationId) });
  const contactQuery = useQuery({ queryKey: ["contact", conversationId], queryFn: () => fetchContactByConversation(token, conversationId).catch(() => ({ contact: null as unknown as ContactRecord })) });
  const labelsQuery = useQuery({ queryKey: ["labels"], queryFn: () => fetchLabels(token) });
  const convLabelsQuery = useQuery({ queryKey: ["conversation-labels", conversationId], queryFn: () => fetchConversationLabels(token, conversationId) });
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: () => fetchAgentProfiles(token) });
  const notesQuery = useQuery({ queryKey: ["notes", conversationId], queryFn: () => fetchConvNotes(token, conversationId) });
  const flowsQuery = useQuery({ queryKey: ["flows"], queryFn: () => fetchPublishedFlows(token) });

  const conv = conversationQuery.data?.conversation;
  const selectedLabels = convLabelsQuery.data?.label_ids ?? [];

  const run = async (action: Promise<unknown>) => {
    try {
      await action;
      onChanged();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["conversation-labels", conversationId] }),
        qc.invalidateQueries({ queryKey: ["notes", conversationId] })
      ]);
    } catch (error) {
      Alert.alert("Update", (error as Error).message);
    }
  };

  if (!conv) {
    return <View style={styles.centerFill}><ActivityIndicator color="#16a34a" /></View>;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.detailsContent}>
      <View style={styles.detailsHero}>
        <View style={styles.avatarLarge}><Text style={styles.avatarLargeText}>{contactTitle(conv).slice(0, 1).toUpperCase()}</Text></View>
        <Text style={styles.detailsName}>{contactTitle(conv)}</Text>
        <Text style={styles.detailsPhone}>{conv.phone_number}</Text>
      </View>
      <Section title="Status">
        <View style={styles.wrapRow}>
          {(["open", "pending", "resolved", "snoozed"] as ConvStatus[]).map((status) => (
            <Chip key={status} label={status} active={conv.status === status} onPress={() => run(patchStatus(token, conversationId, status))} />
          ))}
        </View>
      </Section>
      <Section title="Priority">
        <View style={styles.wrapRow}>
          {(["none", "low", "medium", "high", "urgent"] as ConvPriority[]).map((priority) => (
            <Chip key={priority} label={priority} active={conv.priority === priority} onPress={() => run(patchPriority(token, conversationId, priority))} />
          ))}
        </View>
      </Section>
      <Section title="AI mode">
        <View style={styles.rowBetween}>
          <Text style={styles.sectionText}>{conv.ai_paused || conv.manual_takeover ? "Human takeover" : "AI active"}</Text>
          <Switch value={!(conv.ai_paused || conv.manual_takeover)} onValueChange={(enabled) => run(patchAiMode(token, conversationId, !enabled))} />
        </View>
      </Section>
      <Section title="Labels">
        <View style={styles.wrapRow}>
          {(labelsQuery.data?.labels ?? []).map((label) => {
            const active = selectedLabels.includes(label.id);
            return (
              <Chip
                key={label.id}
                label={label.name}
                active={active}
                onPress={() => run(putLabels(token, conversationId, active ? selectedLabels.filter((id) => id !== label.id) : [...selectedLabels, label.id]))}
              />
            );
          })}
        </View>
      </Section>
      <Section title="Assignment">
        <View style={styles.wrapRow}>
          <Chip label="Unassigned" active={!conv.assigned_agent_profile_id} onPress={() => run(patchAssignAgent(token, conversationId, null))} />
          {(agentsQuery.data?.profiles ?? []).map((agent) => (
            <Chip key={agent.id} label={agent.name} active={conv.assigned_agent_profile_id === agent.id} onPress={() => run(patchAssignAgent(token, conversationId, agent.id))} />
          ))}
        </View>
      </Section>
      <Section title="Flows">
        <View style={styles.wrapRow}>
          {(flowsQuery.data ?? []).map((flow) => (
            <Chip key={flow.id} label={flow.name} active={false} onPress={() => run(assignFlow(token, flow.id, conversationId))} />
          ))}
        </View>
      </Section>
      <Section title="Contact">
        <InfoRow label="Name" value={contactQuery.data?.contact?.display_name ?? conv.contact_name ?? "-"} />
        <InfoRow label="Phone" value={contactQuery.data?.contact?.phone_number ?? conv.phone_number} />
        <InfoRow label="Email" value={contactQuery.data?.contact?.email ?? conv.contact_email ?? "-"} />
        <InfoRow label="Kind" value={contactQuery.data?.contact?.contact_type ?? conv.lead_kind} />
      </Section>
      <Section title="Private notes">
        {(notesQuery.data?.notes ?? []).map((note) => (
          <View key={note.id} style={styles.noteCard}>
            <Text style={styles.noteText}>{note.content}</Text>
            <Text style={styles.noteMeta}>{formatTime(note.created_at)} - {note.sender_name ?? "Agent"}</Text>
          </View>
        ))}
        {(notesQuery.data?.notes ?? []).length === 0 && <Text style={styles.emptyInline}>No private notes</Text>}
      </Section>
    </ScrollView>
  );
}

function NotificationsScreen({ token, notifications, unreadCount, refreshing, onRefresh, onOpenConversation }: { token: string; notifications: AgentNotification[]; unreadCount: number; refreshing: boolean; onRefresh: () => void; onOpenConversation: (id: string) => void }) {
  const qc = useQueryClient();
  return (
    <View style={styles.screen}>
      <View style={styles.notificationsHead}>
        <Text style={styles.sectionText}>{unreadCount} unread</Text>
        <Pressable onPress={() => markAllNotificationsRead(token).then(() => qc.invalidateQueries({ queryKey: ["notifications"] }))}>
          <Text style={styles.linkText}>Mark all read</Text>
        </Pressable>
      </View>
      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.listContent}
        renderItem={({ item }) => (
          <Pressable style={[styles.notificationRow, !item.read_at && styles.notificationUnread]} onPress={() => {
            void markNotificationRead(token, item.id).then(() => qc.invalidateQueries({ queryKey: ["notifications"] }));
            if (item.conversation_id) onOpenConversation(item.conversation_id);
          }}>
            <View style={styles.notificationIcon}><Ionicons name={item.type === "message" ? "chatbubble-outline" : "alert-circle-outline"} size={18} color="#0f766e" /></View>
            <View style={styles.convMiddle}>
              <View style={styles.rowBetween}>
                <Text style={styles.convTitle}>{item.actor_name ?? item.type}</Text>
                <Text style={styles.convTime}>{formatTime(item.created_at)}</Text>
              </View>
              <Text style={styles.convMessage}>{item.body}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={<EmptyState title="No notifications" detail="New message alerts will appear here." />}
      />
    </View>
  );
}

function NewConversationModal({ visible, token, onClose, onCreated }: { visible: boolean; token: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [channelType, setChannelType] = useState<"api" | "qr">("api");
  const contactsQuery = useQuery({
    queryKey: ["contacts", q],
    queryFn: () => listInboxContacts(token, { q, limit: 30 }),
    enabled: visible
  });
  const contacts = contactsQuery.data?.contacts ?? contactsQuery.data?.items ?? [];
  const createMutation = useMutation({
    mutationFn: (contact: InboxContact) => createOutboundConversation(token, { contactId: contact.id, channelType }),
    onSuccess: (result) => onCreated(result.conversationId),
    onError: (error) => Alert.alert("New conversation", (error as Error).message)
  });

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.root}>
        <View style={styles.topBar}>
          <IconButton name="close" onPress={onClose} />
          <Text style={styles.topBarTitle}>New conversation</Text>
          <View style={{ width: 44 }} />
        </View>
        <View style={styles.screen}>
          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={18} color="#64748b" />
            <TextInput value={q} onChangeText={setQ} placeholder="Search contacts" placeholderTextColor="#94a3b8" style={styles.searchInput} />
          </View>
          <View style={styles.wrapRow}>
            <Chip label="API" active={channelType === "api"} onPress={() => setChannelType("api")} />
            <Chip label="QR" active={channelType === "qr"} onPress={() => setChannelType("qr")} />
          </View>
          <FlatList
            data={contacts}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable style={styles.convRow} onPress={() => createMutation.mutate(item)}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{(item.display_name || item.phone_number).slice(0, 1).toUpperCase()}</Text></View>
                <View style={styles.convMiddle}>
                  <Text style={styles.convTitle}>{item.display_name || item.phone_number}</Text>
                  <Text style={styles.convMessage}>{item.phone_number}</Text>
                </View>
              </Pressable>
            )}
            ListEmptyComponent={<EmptyState title="No contacts" detail="Create or import contacts from the web dashboard." />}
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Badge({ label, tone }: { label: string; tone: "neutral" | "warning" | "success" }) {
  return <Text style={[styles.badge, tone === "warning" && styles.badgeWarning, tone === "success" && styles.badgeSuccess]}>{label}</Text>;
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function IconButton({ name, onPress, active }: { name: keyof typeof Ionicons.glyphMap; onPress: () => void; active?: boolean }) {
  return (
    <Pressable style={[styles.iconButton, active && styles.iconButtonActive]} onPress={onPress}>
      <Ionicons name={name} size={21} color={active ? "#047857" : "#0f172a"} />
    </Pressable>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <View style={styles.emptyState}>
      <Ionicons name="chatbubbles-outline" size={36} color="#94a3b8" />
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
    </View>
  );
}

const priorityColors: Record<string, string> = {
  none: "#94a3b8",
  low: "#22c55e",
  medium: "#f59e0b",
  high: "#f97316",
  urgent: "#ef4444"
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  screen: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f8fafc" },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  authRoot: { flex: 1, backgroundColor: "#f8fafc", padding: 20, justifyContent: "center" },
  authBrand: { alignItems: "center", marginBottom: 24 },
  logoMark: { width: 58, height: 58, borderRadius: 14, backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center", marginBottom: 14 },
  logoMarkText: { color: "#ffffff", fontWeight: "800", fontSize: 28 },
  authTitle: { fontSize: 26, fontWeight: "800", color: "#0f172a" },
  authSubtitle: { marginTop: 8, color: "#64748b", fontSize: 14, textAlign: "center" },
  authPanel: { backgroundColor: "#ffffff", borderRadius: 8, padding: 16, borderWidth: 1, borderColor: "#e2e8f0" },
  authFoot: { textAlign: "center", marginTop: 18, color: "#64748b", fontSize: 12 },
  fieldLabel: { color: "#334155", fontWeight: "700", marginBottom: 8, marginTop: 10 },
  input: { backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, minHeight: 48, paddingHorizontal: 12, color: "#0f172a", fontSize: 16 },
  devCode: { color: "#047857", marginTop: 10, fontWeight: "700" },
  primaryButton: { backgroundColor: "#16a34a", minHeight: 48, borderRadius: 8, alignItems: "center", justifyContent: "center", marginTop: 16 },
  primaryButtonText: { color: "#ffffff", fontWeight: "800" },
  disabledButton: { opacity: 0.55 },
  textButton: { alignItems: "center", marginTop: 14 },
  textButtonText: { color: "#047857", fontWeight: "700" },
  topBar: { minHeight: 58, backgroundColor: "#ffffff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 10 },
  topBarTitleWrap: { flex: 1 },
  topBarTitle: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  topBarSub: { fontSize: 12, color: "#64748b", marginTop: 2 },
  logoSmall: { width: 36, height: 36, borderRadius: 8, backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center" },
  logoSmallText: { color: "#ffffff", fontWeight: "800", fontSize: 18 },
  iconButton: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0" },
  iconButtonActive: { backgroundColor: "#dcfce7", borderColor: "#86efac" },
  bellButton: { width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: "#f1f5f9", borderWidth: 1, borderColor: "#e2e8f0" },
  bellBadge: { position: "absolute", top: -5, right: -5, minWidth: 19, height: 19, borderRadius: 10, backgroundColor: "#ef4444", color: "#ffffff", fontSize: 10, fontWeight: "800", textAlign: "center", paddingTop: 2 },
  searchRow: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingTop: 12, alignItems: "center" },
  searchBox: { flex: 1, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#ffffff", borderRadius: 8, borderWidth: 1, borderColor: "#e2e8f0", paddingHorizontal: 12 },
  searchInput: { flex: 1, color: "#0f172a", fontSize: 15, minHeight: 42 },
  folderTabs: { gap: 8, paddingHorizontal: 12, paddingVertical: 10 },
  chip: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: "#cbd5e1", backgroundColor: "#ffffff" },
  chipActive: { backgroundColor: "#dcfce7", borderColor: "#16a34a" },
  chipText: { color: "#334155", fontWeight: "700", fontSize: 12, textTransform: "capitalize" },
  chipTextActive: { color: "#047857" },
  filterPanel: { backgroundColor: "#ffffff", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#e2e8f0", paddingVertical: 10 },
  optionGroup: { marginBottom: 10 },
  optionTitle: { paddingHorizontal: 12, color: "#475569", fontWeight: "800", marginBottom: 7, fontSize: 12 },
  optionChips: { gap: 8, paddingHorizontal: 12 },
  listContent: { padding: 12, paddingBottom: 32 },
  convRow: { flexDirection: "row", gap: 12, padding: 12, backgroundColor: "#ffffff", borderRadius: 8, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 10, alignItems: "center" },
  avatar: { width: 44, height: 44, borderRadius: 8, backgroundColor: "#e0f2fe", alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#0369a1", fontWeight: "800", fontSize: 18 },
  convMiddle: { flex: 1, minWidth: 0 },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  convTitle: { flex: 1, fontSize: 15, fontWeight: "800", color: "#0f172a" },
  convTime: { color: "#64748b", fontSize: 11 },
  convMessage: { color: "#64748b", fontSize: 13, marginTop: 4, lineHeight: 18 },
  convMeta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, flexWrap: "wrap" },
  badge: { fontSize: 10, color: "#334155", backgroundColor: "#f1f5f9", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, overflow: "hidden", textTransform: "uppercase", fontWeight: "800" },
  badgeWarning: { backgroundColor: "#fef3c7", color: "#92400e" },
  badgeSuccess: { backgroundColor: "#dcfce7", color: "#166534" },
  metaText: { color: "#64748b", fontSize: 11, textTransform: "capitalize" },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  unreadBadge: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: "#16a34a", color: "#ffffff", textAlign: "center", paddingTop: 4, fontWeight: "800", fontSize: 12 },
  threadHeader: { backgroundColor: "#ffffff", borderBottomWidth: 1, borderBottomColor: "#e2e8f0", paddingHorizontal: 12, paddingVertical: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  threadTitle: { fontSize: 16, fontWeight: "800", color: "#0f172a" },
  threadSub: { color: "#64748b", fontSize: 12, marginTop: 2, textTransform: "capitalize" },
  messagesContent: { padding: 12, paddingBottom: 18 },
  messageWrap: { marginVertical: 5, flexDirection: "row" },
  messageWrapInbound: { justifyContent: "flex-start" },
  messageWrapOutbound: { justifyContent: "flex-end" },
  messageBubble: { maxWidth: "84%", borderRadius: 8, padding: 10, borderWidth: 1 },
  inboundBubble: { backgroundColor: "#ffffff", borderColor: "#e2e8f0" },
  outboundBubble: { backgroundColor: "#16a34a", borderColor: "#16a34a" },
  messageText: { color: "#0f172a", fontSize: 15, lineHeight: 21 },
  outboundText: { color: "#ffffff" },
  messageMetaRow: { flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 6 },
  messageMeta: { color: "#64748b", fontSize: 10 },
  outboundMeta: { color: "#dcfce7" },
  mediaText: { color: "#0f766e", fontSize: 11, fontWeight: "700", marginBottom: 6 },
  retryButton: { backgroundColor: "#fee2e2", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, marginTop: 8, alignSelf: "flex-start" },
  retryText: { color: "#991b1b", fontWeight: "800", fontSize: 12 },
  compose: { flexDirection: "row", alignItems: "flex-end", gap: 6, padding: 8, backgroundColor: "#ffffff", borderTopWidth: 1, borderTopColor: "#e2e8f0" },
  composeInput: { flex: 1, maxHeight: 110, minHeight: 42, backgroundColor: "#f8fafc", borderWidth: 1, borderColor: "#cbd5e1", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9, color: "#0f172a" },
  sendButton: { width: 42, height: 42, borderRadius: 8, backgroundColor: "#16a34a", alignItems: "center", justifyContent: "center" },
  toolPanel: { backgroundColor: "#ffffff", borderTopWidth: 1, borderColor: "#e2e8f0", padding: 10 },
  panelTitle: { color: "#0f172a", fontWeight: "800", fontSize: 14 },
  toolItems: { gap: 8, paddingTop: 8 },
  toolItem: { width: 190, borderRadius: 8, borderWidth: 1, borderColor: "#e2e8f0", padding: 10, backgroundColor: "#f8fafc" },
  toolLabel: { fontWeight: "800", color: "#0f172a" },
  toolDetail: { color: "#64748b", marginTop: 4, fontSize: 12 },
  notePanel: { backgroundColor: "#ffffff", borderTopWidth: 1, borderColor: "#e2e8f0", padding: 10, flexDirection: "row", gap: 8, alignItems: "center" },
  noteInput: { flex: 1, minHeight: 44, borderRadius: 8, borderWidth: 1, borderColor: "#cbd5e1", paddingHorizontal: 10, color: "#0f172a" },
  primarySmall: { backgroundColor: "#16a34a", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10 },
  primarySmallText: { color: "#ffffff", fontWeight: "800" },
  detailsContent: { padding: 12, paddingBottom: 40 },
  detailsHero: { alignItems: "center", backgroundColor: "#ffffff", borderRadius: 8, borderWidth: 1, borderColor: "#e2e8f0", padding: 18, marginBottom: 12 },
  avatarLarge: { width: 66, height: 66, borderRadius: 14, backgroundColor: "#dcfce7", alignItems: "center", justifyContent: "center", marginBottom: 10 },
  avatarLargeText: { color: "#047857", fontSize: 26, fontWeight: "800" },
  detailsName: { fontSize: 18, fontWeight: "800", color: "#0f172a" },
  detailsPhone: { marginTop: 4, color: "#64748b" },
  section: { backgroundColor: "#ffffff", borderRadius: 8, borderWidth: 1, borderColor: "#e2e8f0", padding: 12, marginBottom: 12 },
  sectionTitle: { color: "#0f172a", fontWeight: "800", marginBottom: 10 },
  sectionText: { color: "#334155", fontWeight: "700" },
  wrapRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  infoLabel: { color: "#64748b" },
  infoValue: { color: "#0f172a", fontWeight: "700", flex: 1, textAlign: "right" },
  noteCard: { backgroundColor: "#f8fafc", borderRadius: 8, borderWidth: 1, borderColor: "#e2e8f0", padding: 10, marginBottom: 8 },
  noteText: { color: "#0f172a", lineHeight: 19 },
  noteMeta: { color: "#64748b", fontSize: 11, marginTop: 6 },
  notificationsHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 12 },
  linkText: { color: "#047857", fontWeight: "800" },
  notificationRow: { flexDirection: "row", gap: 12, padding: 12, backgroundColor: "#ffffff", borderRadius: 8, borderWidth: 1, borderColor: "#e2e8f0", marginBottom: 10 },
  notificationUnread: { borderColor: "#86efac", backgroundColor: "#f0fdf4" },
  notificationIcon: { width: 38, height: 38, borderRadius: 8, backgroundColor: "#ccfbf1", alignItems: "center", justifyContent: "center" },
  emptyState: { alignItems: "center", justifyContent: "center", padding: 28 },
  emptyTitle: { marginTop: 10, color: "#334155", fontWeight: "800", fontSize: 15 },
  emptyDetail: { color: "#64748b", fontSize: 13, marginTop: 4, textAlign: "center" },
  emptyInline: { color: "#64748b", padding: 8 }
});

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
