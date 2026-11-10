import { useEffect, useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useStaffAccess } from "@/hooks/useStaffAccess";
import DashboardLayout from "@/components/layout/DashboardLayout";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import {
  MessageSquare,
  Search,
  User,
  Send,
  Loader2,
  Phone,
  ArrowLeft,
  Bot,
  HandMetal,
  Trash2,
  Crosshair,
  Mic,
} from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useSearchParams } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface Message {
  id: string;
  phone_number: string;
  message: string;
  direction: string;
  message_type: string | null;
  metadata: any;
  created_at: string;
}

interface ChatThread {
  phone_number: string;
  last_message: string;
  last_time: string;
  sender_name: string;
  unread_count: number;
}

interface TrackedPhone {
  phone_number: string;
  faq_questions: string[];
}

export default function Conversations() {
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedPhone, setSelectedPhone] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMoreThreads, setHasMoreThreads] = useState(true);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [replyText, setReplyText] = useState("");
  const [sending, setSending] = useState(false);
  const [takenOverChats, setTakenOverChats] = useState<Set<string>>(new Set());
  const [togglingTakeover, setTogglingTakeover] = useState(false);
  const [trackedPhones, setTrackedPhones] = useState<Map<string, string[]>>(new Map());
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const { effectiveUserId } = useStaffAccess();
  const [searchParams, setSearchParams] = useSearchParams();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const formatWhatsAppText = (text: string) => {
    return (text || "")
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\*(.+?)\*/g, '<strong>$1</strong>')
      .replace(/_(.+?)_/g, '<em>$1</em>')
      .replace(/~(.+?)~/g, '<del>$1</del>');
  };

  const formatTime = (dateStr: string) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "";
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = diff / (1000 * 60 * 60);

    if (hours < 24) {
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    }
    if (hours < 48) return "Yesterday";
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  const fetchMessages = useCallback(
    async (phoneNumber: string) => {
      setMessagesLoading(true);
      try {
        const { data, error } = await supabase
          .from("conversations")
          .select("*")
          .eq("phone_number", phoneNumber)
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw error;
        const list = (data || []).reverse();
        setMessages(list);
        setHasMoreMessages((data || []).length === 50);
        setTimeout(scrollToBottom, 100);
      } catch (error: any) {
        toast({
          title: "Error loading messages",
          description: error.message,
          variant: "destructive",
        });
      } finally {
        setMessagesLoading(false);
      }
    },
    [toast]
  );

  const loadOlderMessages = async () => {
    if (!selectedPhone || messages.length === 0 || loadingOlderMessages) return;
    setLoadingOlderMessages(true);
    try {
      const oldestTimestamp = messages[0].created_at;
      const { data, error } = await supabase
        .from("conversations")
        .select("*")
        .eq("phone_number", selectedPhone)
        .lt("created_at", oldestTimestamp)
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      const older = (data || []).reverse();
      setHasMoreMessages((data || []).length === 50);
      setMessages((prev) => [...older, ...prev]);
    } catch (error: any) {
      toast({
        title: "Error loading older messages",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoadingOlderMessages(false);
    }
  };

  const fetchThreads = useCallback(async (search?: string, offset: number = 0) => {
    try {
      if (offset === 0) {
        setLoading(true);
      } else {
        setLoadingMoreThreads(true);
      }

      const limit = 50;
      const { data, error } = await supabase.rpc("get_chat_threads", {
        _limit: limit,
        _offset: offset,
        _search: search && search.trim() ? search.trim() : null,
      });

      if (error) throw error;

      const loaded = (data as ChatThread[]) || [];
      setHasMoreThreads(loaded.length >= limit);

      setThreads((prev) => (offset === 0 ? loaded : [...prev, ...loaded]));
    } catch (error: any) {
      console.error("Error fetching threads:", error);
      toast({
        title: "Error loading conversations",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setLoadingMoreThreads(false);
    }
  }, [toast]);

  // Fetch tracked FAQ usage phones
  const fetchTrackedPhones = useCallback(async () => {
    if (!user) return;
    try {
      const { data } = await supabase
        .from("faq_usage_logs" as any)
        .select("phone_number, faq_id, faqs!inner(question)")
        .order("created_at", { ascending: false });

      if (data) {
        const phoneMap = new Map<string, string[]>();
        for (const row of data as any[]) {
          const phone = row.phone_number;
          const question = row.faqs?.question || "Unknown FAQ";
          if (!phoneMap.has(phone)) {
            phoneMap.set(phone, []);
          }
          const existing = phoneMap.get(phone)!;
          if (!existing.includes(question)) {
            existing.push(question);
          }
        }
        setTrackedPhones(phoneMap);
      }
    } catch (err) {
      console.error("Error fetching tracked phones:", err);
    }
  }, [user]);

  // Fetch all takeover states for the user
  const fetchTakeovers = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("chat_takeovers" as any)
      .select("phone_number")
      .eq("user_id", user.id)
      .eq("is_taken_over", true);
    if (data) {
      setTakenOverChats(new Set((data as any[]).map((d: any) => d.phone_number)));
    }
  }, [user]);

  const toggleTakeover = useCallback(async (phoneNumber: string) => {
    if (!user || togglingTakeover) return;
    setTogglingTakeover(true);
    try {
      const isTakenOver = takenOverChats.has(phoneNumber);
      if (isTakenOver) {
        await (supabase.from("chat_takeovers" as any) as any)
          .delete()
          .eq("user_id", effectiveUserId || user.id)
          .eq("phone_number", phoneNumber);
        setTakenOverChats(prev => {
          const next = new Set(prev);
          next.delete(phoneNumber);
          return next;
        });
        toast({ title: "Bot re-enabled for this chat" });
      } else {
        await (supabase.from("chat_takeovers" as any) as any)
          .upsert({
            user_id: effectiveUserId || user.id,
            phone_number: phoneNumber,
            is_taken_over: true,
          }, { onConflict: "user_id,phone_number" });
        setTakenOverChats(prev => new Set(prev).add(phoneNumber));
        toast({ title: "Bot paused — you're in control" });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setTogglingTakeover(false);
    }
  }, [user, takenOverChats, togglingTakeover, effectiveUserId, toast]);

  const deleteThread = async (phoneNumber: string) => {
    try {
      const { error } = await supabase
        .from("conversations")
        .delete()
        .eq("phone_number", phoneNumber);
      if (error) throw error;
      await (supabase.from("chat_takeovers" as any) as any)
        .delete()
        .eq("phone_number", phoneNumber);
      if (selectedPhone === phoneNumber) {
        setSelectedPhone(null);
        setMessages([]);
      }
      setThreads((prev) => prev.filter((t) => t.phone_number !== phoneNumber));
      toast({ title: "Conversation deleted" });
    } catch (error: any) {
      toast({ title: "Error deleting conversation", description: error.message, variant: "destructive" });
    }
  };

  const handleSelectThread = (phoneNumber: string) => {
    setSelectedPhone(phoneNumber);
    fetchMessages(phoneNumber);
  };

  const handleSendReply = async () => {
    if (!replyText.trim() || !selectedPhone || sending) return;

    setSending(true);
    try {
      const ownerId = effectiveUserId || user!.id;
      const { data: sessionData, error: sessionError } = await supabase
        .from("user_wsender_sessions" as any)
        .select("session_api_key, session_id")
        .eq("user_id", ownerId)
        .limit(1)
        .maybeSingle();

      if (sessionError) throw sessionError;

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-whatsapp`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: selectedPhone,
            message: replyText,
            sessionApiKey: (sessionData as any)?.session_api_key || (sessionData as any)?.session_id,
          }),
        }
      );

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Failed to send message");
      }

      await supabase.from("conversations").insert({
        phone_number: selectedPhone,
        message: replyText,
        direction: "outbound",
        message_type: "text",
        user_id: ownerId,
      });

      setReplyText("");
      toast({ title: "Message sent" });
    } catch (error: any) {
      toast({
        title: "Error sending message",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setSending(false);
    }
  };

  // Effects placed strictly after callbacks
  useEffect(() => {
    fetchTakeovers();
    fetchTrackedPhones();
  }, [fetchTakeovers, fetchTrackedPhones]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchThreads(searchQuery, 0);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, fetchThreads]);

  useEffect(() => {
    const phoneParam = searchParams.get("phone");
    if (phoneParam && !selectedPhone) {
      setSelectedPhone(phoneParam);
      fetchMessages(phoneParam);
      setThreads((prev) => {
        if (!prev.some((t) => t.phone_number === phoneParam)) {
          return [
            {
              phone_number: phoneParam,
              last_message: "",
              last_time: new Date().toISOString(),
              sender_name: "Customer",
              unread_count: 0,
            },
            ...prev,
          ];
        }
        return prev;
      });
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, selectedPhone, fetchMessages, setSearchParams]);

  // Realtime subscription for new messages
  useEffect(() => {
    const channel = supabase
      .channel("conversations-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "conversations" },
        (payload) => {
          const newMsg = payload.new as Message;

          setThreads((prev) => {
            const existing = prev.find(
              (t) => t.phone_number === newMsg.phone_number
            );
            if (existing) {
              const updated = {
                ...existing,
                last_message: newMsg.message,
                last_time: newMsg.created_at,
              };
              return [updated, ...prev.filter((t) => t.phone_number !== newMsg.phone_number)];
            }
            return [
              {
                phone_number: newMsg.phone_number,
                last_message: newMsg.message,
                last_time: newMsg.created_at,
                sender_name:
                  (newMsg.metadata as any)?.senderName || "Unknown",
                unread_count: 0,
              },
              ...prev,
            ];
          });

          if (newMsg.phone_number === selectedPhone) {
            setMessages((prev) => [...prev, newMsg]);
            setTimeout(scrollToBottom, 100);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [selectedPhone]);

  const filteredThreads = searchQuery.trim()
    ? threads.filter(
        (t) =>
          (t.phone_number || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
          (t.sender_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
          (t.last_message || "").toLowerCase().includes(searchQuery.toLowerCase())
      )
    : threads;

  return (
    <DashboardLayout>
      <div className="h-[calc(100vh-7rem)] lg:h-[calc(100vh-8rem)] flex flex-col">
        <div className={cn("mb-4", selectedPhone && "hidden md:block")}>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Conversations</h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            WhatsApp chat history and live messages
          </p>
        </div>

        <Card className="flex-1 flex overflow-hidden">
          {/* Thread List */}
          <div
            className={cn(
              "w-full md:w-80 border-r flex flex-col",
              selectedPhone ? "hidden md:flex" : "flex"
            )}
          >
            <div className="p-3 border-b">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search chats..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>
            <ScrollArea className="flex-1">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredThreads.length === 0 ? (
                <div className="text-center py-8 px-4">
                  <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No conversations yet
                  </p>
                </div>
              ) : (
                <TooltipProvider>
                  {filteredThreads.map((thread) => {
                    const isTracked = trackedPhones.has(thread.phone_number);
                    const trackedFaqs = trackedPhones.get(thread.phone_number) || [];
                    
                    return (
                      <button
                        key={thread.phone_number}
                        onClick={() => handleSelectThread(thread.phone_number)}
                        className={cn(
                          "w-full text-left px-4 py-3 border-b hover:bg-muted/50 transition-colors",
                          selectedPhone === thread.phone_number && "bg-muted",
                          isTracked && "border-l-4 border-l-primary bg-primary/5"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className="flex flex-col items-center gap-1 flex-shrink-0">
                            <div className={cn(
                              "h-10 w-10 rounded-full flex items-center justify-center",
                              isTracked ? "bg-primary/20 ring-2 ring-primary" : "bg-primary/10"
                            )}>
                              <User className={cn("h-5 w-5", isTracked ? "text-primary" : "text-primary")} />
                            </div>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <span
                                  role="button"
                                  onClick={(e) => e.stopPropagation()}
                                  className="p-1.5 rounded hover:bg-destructive/10 text-destructive/60 hover:text-destructive transition-colors cursor-pointer"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </span>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Conversation</AlertDialogTitle>
                                  <AlertDialogDescription>This will permanently delete all messages with {thread.phone_number}. This action cannot be undone.</AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteThread(thread.phone_number)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <p className={cn(
                                  "font-medium text-sm truncate",
                                  isTracked && "text-primary font-bold"
                                )}>
                                  {thread.sender_name}
                                </p>
                                {isTracked && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span>
                                        <Crosshair className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className="max-w-xs">
                                      <p className="font-medium text-xs mb-1">Triggered tracked FAQs:</p>
                                      <ul className="text-xs space-y-0.5">
                                        {trackedFaqs.map((q, i) => (
                                          <li key={i} className="truncate">• {q}</li>
                                        ))}
                                      </ul>
                                    </TooltipContent>
                                  </Tooltip>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                                {formatTime(thread.last_time)}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Phone className="h-3 w-3" />
                              {thread.phone_number}
                            </p>
                            <p className="text-sm text-muted-foreground truncate mt-0.5">
                              {thread.last_message}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {hasMoreThreads && (
                    <div className="p-3 text-center border-t">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-full text-xs text-muted-foreground hover:text-foreground"
                        disabled={loadingMoreThreads}
                        onClick={() => fetchThreads(searchQuery, threads.length)}
                      >
                        {loadingMoreThreads ? (
                          <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                        ) : (
                          "Load more chats..."
                        )}
                      </Button>
                    </div>
                  )}
                </TooltipProvider>
              )}
            </ScrollArea>
          </div>

          {/* Chat Area */}
          <div
            className={cn(
              "flex-1 flex flex-col",
              !selectedPhone ? "hidden md:flex" : "flex"
            )}
          >
            {selectedPhone ? (
              <>
                {/* Chat Header */}
                <div className="flex items-center gap-3 p-4 border-b bg-card">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    onClick={() => setSelectedPhone(null)}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <div className={cn(
                    "h-9 w-9 rounded-full flex items-center justify-center",
                    trackedPhones.has(selectedPhone) ? "bg-primary/20 ring-2 ring-primary" : "bg-primary/10"
                  )}>
                    <User className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn(
                        "font-medium text-sm",
                        trackedPhones.has(selectedPhone) && "text-primary font-bold"
                      )}>
                        {threads.find((t) => t.phone_number === selectedPhone)
                          ?.sender_name || "Unknown"}
                      </p>
                      {trackedPhones.has(selectedPhone) && (
                        <Badge variant="outline" className="gap-1 text-xs border-primary/50 text-primary">
                          <Crosshair className="h-3 w-3" />
                          FAQ Tracked
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedPhone}
                    </p>
                  </div>
                  <Button
                    variant={takenOverChats.has(selectedPhone) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleTakeover(selectedPhone)}
                    disabled={togglingTakeover}
                    className="gap-1.5"
                  >
                    {takenOverChats.has(selectedPhone) ? (
                      <>
                        <HandMetal className="h-4 w-4" />
                        <span className="hidden sm:inline">Taken Over</span>
                      </>
                    ) : (
                      <>
                        <Bot className="h-4 w-4" />
                        <span className="hidden sm:inline">Bot Active</span>
                      </>
                    )}
                  </Button>
                </div>

                {/* Messages */}
                <ScrollArea className="flex-1 p-4">
                  {messagesLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {hasMoreMessages && (
                        <div className="text-center py-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={loadingOlderMessages}
                            onClick={loadOlderMessages}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            {loadingOlderMessages ? (
                              <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                            ) : (
                              "Load earlier messages"
                            )}
                          </Button>
                        </div>
                      )}
                      {messages.map((msg) => (
                        <div
                          key={msg.id}
                          className={cn(
                            "flex",
                            msg.direction === "outbound"
                              ? "justify-end"
                              : "justify-start"
                          )}
                        >
                          <div
                            className={cn(
                              "max-w-[75%] rounded-2xl px-4 py-2 text-sm",
                              msg.direction === "outbound"
                                ? "bg-primary text-primary-foreground rounded-br-md"
                                : "bg-muted rounded-bl-md"
                            )}
                          >
                            {msg.message_type === "audio" || msg.message_type === "ptt" ? (
                              <div className="flex items-center gap-1.5 opacity-80">
                                <Mic className="h-4 w-4" />
                                <span className="italic">Voice message</span>
                              </div>
                            ) : (
                              <p className="whitespace-pre-wrap" dangerouslySetInnerHTML={{ __html: formatWhatsAppText(msg.message) }} />
                            )}
                            <p
                              className={cn(
                                "text-[10px] mt-1",
                                msg.direction === "outbound"
                                  ? "text-primary-foreground/70"
                                  : "text-muted-foreground"
                              )}
                            >
                              {new Date(msg.created_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </p>
                          </div>
                        </div>
                      ))}
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </ScrollArea>

                {/* Reply Input */}
                <div className="p-3 border-t bg-card">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleSendReply();
                    }}
                    className="flex gap-2"
                  >
                    <Input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Type a message..."
                      className="flex-1"
                      disabled={sending}
                    />
                    <Button
                      type="submit"
                      size="icon"
                      disabled={!replyText.trim() || sending}
                    >
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                    </Button>
                  </form>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <MessageSquare className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                  <p className="text-lg font-medium text-muted-foreground">
                    Select a conversation
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Choose a chat from the list to view messages
                  </p>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
