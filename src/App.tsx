import { useEffect, useMemo, useState, useRef } from 'react';
import { supabase } from './supabaseClient';

type MediaType = 'photo' | 'video';

interface PhotoRecord {
  id: string;
  uploader_email: string;
  uploader_name: string;
  media_type: MediaType;
  description: string;
  category: string | null;
  original_path: string;
  preview_path: string | null;
  created_at: string;
}

interface DirectoryEntry {
  email: string;
  name: string;
}

interface GroupRecord {
  id: string;
  name: string;
  created_by: string;
}

interface MessageRecord {
  id: string;
  sender_email: string;
  recipient_email: string | null;
  group_id: string | null;
  photo_id: string | null;
  body: string;
  created_at: string;
}

type ThreadRef = { type: 'dm' | 'group'; id: string; label: string };

const CONFIG = {
  HEADLINE: 'Share Your Photos & Videos From The Big Day',
  COUPLE: 'The Newlyweds',
  DATE: 'August 8, 2026',
  SITE_URL: 'https://anderson-wedding-album.vercel.app',
  INVITE_WEBHOOK_URL: '', // paste your Zapier "Catch Hook" URL here once created
};

const MAX_PREVIEW_DIM = 1200;
const PREVIEW_QUALITY = 0.75;

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [pendingConfirm, setPendingConfirm] = useState<{ email: string; token: string } | null>(null);
  const [confirmError, setConfirmError] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [notAllowed, setNotAllowed] = useState<'missing' | 'disabled' | null>(null);

  const [photos, setPhotos] = useState<PhotoRecord[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const [loadingGallery, setLoadingGallery] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const [batchDescription, setBatchDescription] = useState('');

  const [uploaderFilter, setUploaderFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'uploader'>('newest');

  const [lightbox, setLightbox] = useState<PhotoRecord | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string>('');

  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [guestList, setGuestList] = useState<{ email: string; name: string; is_admin: boolean; is_disabled: boolean }[]>([]);
  const [newGuestEmail, setNewGuestEmail] = useState('');
  const [newGuestName, setNewGuestName] = useState('');
  const [guestError, setGuestError] = useState('');

  const [isDragOver, setIsDragOver] = useState(false);

  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showCategoryPanel, setShowCategoryPanel] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState('');

  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState('');

  const [requestFirstName, setRequestFirstName] = useState('');
  const [requestLastName, setRequestLastName] = useState('');
  const [requestEmail, setRequestEmail] = useState('');
  const [existingRequest, setExistingRequest] = useState<{ status: string } | null>(null);
  const [requestSubmitted, setRequestSubmitted] = useState(false);
  const [requestError, setRequestError] = useState('');

  const [pendingRequests, setPendingRequests] = useState<{ id: string; email: string; first_name: string; last_name: string; status: string }[]>([]);
  const [showRequestsPanel, setShowRequestsPanel] = useState(false);

  const [showMessagesPanel, setShowMessagesPanel] = useState(false);
  const [directory, setDirectory] = useState<DirectoryEntry[]>([]);
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [selectedThread, setSelectedThread] = useState<ThreadRef | null>(null);
  const [threadMessages, setThreadMessages] = useState<MessageRecord[]>([]);
  const [newMessageBody, setNewMessageBody] = useState('');
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupMembers, setNewGroupMembers] = useState<string[]>([]);
  const [messagesError, setMessagesError] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editMessageBody, setEditMessageBody] = useState('');
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editCommentBody, setEditCommentBody] = useState('');
  const [renamingGroup, setRenamingGroup] = useState(false);
  const [renameGroupName, setRenameGroupName] = useState('');

  const [showMyPhotosPanel, setShowMyPhotosPanel] = useState(false);
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([]);
  const [activeFolderId, setActiveFolderId] = useState<string | null>(null);
  const [folderPhotoIds, setFolderPhotoIds] = useState<string[]>([]);
  const [newFolderName, setNewFolderName] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderName, setRenameFolderName] = useState('');
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [myPhotosFilter, setMyPhotosFilter] = useState<'mine' | 'all'>('mine');
  const [addToFolderChoice, setAddToFolderChoice] = useState('');

  const [sectionOrder, setSectionOrder] = useState<string[]>(['upload', 'gallery', 'messages', 'myphotos']);
  const [showLayoutPanel, setShowLayoutPanel] = useState(false);
  const [showAdminToolsRow, setShowAdminToolsRow] = useState(false);
  const [showHelpPanel, setShowHelpPanel] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [slideshowPhotos, setSlideshowPhotos] = useState<PhotoRecord[] | null>(null);
  const [slideshowIndex, setSlideshowIndex] = useState(0);
  const [slideshowUrl, setSlideshowUrl] = useState('');
  const [slideshowPlaying, setSlideshowPlaying] = useState(true);
  const slideshowVideoRef = useRef<HTMLVideoElement>(null);
  const [layoutSort, setLayoutSort] = useState<'newest' | 'oldest' | 'uploader'>('newest');
  const [layoutSaved, setLayoutSaved] = useState(false);

  const [photoComments, setPhotoComments] = useState<MessageRecord[]>([]);
  const [newCommentBody, setNewCommentBody] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const myPhotosPanelRef = useRef<HTMLDivElement>(null);
  const messagesPanelRef = useRef<HTMLDivElement>(null);

  function scrollToPanel(ref: React.RefObject<HTMLDivElement>) {
    setTimeout(() => ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  // ---- Auth bootstrap ----
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // ---- Detect a "click to finish signing in" link (safe against email link-scanners) ----
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ce = params.get('confirm_email');
    const ct = params.get('confirm_token');
    if (ce && ct) {
      setPendingConfirm({ email: ce, token: ct });
    }
  }, []);

  async function confirmFromLink() {
    if (!pendingConfirm) return;
    setConfirmBusy(true);
    setConfirmError('');
    const { error } = await supabase.auth.verifyOtp({
      email: pendingConfirm.email,
      token: pendingConfirm.token,
      type: 'email',
    });
    setConfirmBusy(false);
    if (error) {
      setConfirmError(error.message);
      return;
    }
    // Clean the token out of the URL so refreshing doesn't retry a used-up code.
    window.history.replaceState({}, '', window.location.pathname);
    setPendingConfirm(null);
  }

  // ---- Load photos once signed in ----
  useEffect(() => {
    if (session) {
      loadPhotos();
      loadGuestInfo();
      loadCategories();
      loadDirectory();
      loadGroups();
      loadFolders();
      loadSiteSettings();
    }
  }, [session]);

  useEffect(() => {
    if (isAdmin) {
      loadPendingRequests();
    }
  }, [isAdmin]);

  async function loadCategories() {
    const { data, error } = await supabase.from('categories').select('*').order('name');
    if (error || !data) return;
    setCategories(data as any);
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault();
    setCategoryError('');
    const name = newCategoryName.trim();
    if (!name) return;
    const { error } = await supabase.from('categories').insert({ name });
    if (error) {
      setCategoryError(error.message);
      return;
    }
    setNewCategoryName('');
    loadCategories();
  }

  async function removeCategory(id: string) {
    await supabase.from('categories').delete().eq('id', id);
    loadCategories();
  }

  async function loadGuestInfo() {
    const { data, error } = await supabase.from('allowed_guests').select('*');
    if (error || !data) return;
    const me = data.find((g: any) => g.email === session.user.email);
    setIsAdmin(!!me?.is_admin);
    setGuestList(data as any);
  }

  async function addGuest(e: React.FormEvent) {
    e.preventDefault();
    setGuestError('');
    const email = newGuestEmail.trim().toLowerCase();
    const name = newGuestName.trim();
    if (!email || !name) {
      setGuestError('Enter both a name and email.');
      return;
    }
    const { error } = await supabase.from('allowed_guests').insert({ email, name, is_admin: false });
    if (error) {
      setGuestError(error.message);
      return;
    }
    setNewGuestEmail('');
    setNewGuestName('');
    loadGuestInfo();
  }

  async function removeGuest(email: string) {
    if (email === session.user.email) {
      setGuestError("You can't remove yourself.");
      return;
    }
    await supabase.from('allowed_guests').delete().eq('email', email);
    loadGuestInfo();
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setAuthError('');
    if (!emailInput.trim()) {
      setAuthError('Enter your email.');
      return;
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: emailInput.trim(),
      options: {
        data: { display_name: nameInput.trim() || emailInput.trim() },
      },
    });
    if (error) {
      setAuthError(error.message);
      return;
    }
    setMagicLinkSent(true);
  }

  async function verifyOtpCode(e: React.FormEvent) {
    e.preventDefault();
    setOtpError('');
    const code = otpCode.trim();
    if (!code) {
      setOtpError('Enter the 6-digit code from your email.');
      return;
    }
    setOtpVerifying(true);
    const { error } = await supabase.auth.verifyOtp({
      email: emailInput.trim(),
      token: code,
      type: 'email',
    });
    setOtpVerifying(false);
    if (error) {
      setOtpError(error.message);
      return;
    }
    // On success, Supabase's onAuthStateChange listener picks up the new session automatically.
  }

  async function loadPhotos() {
    setLoadingGallery(true);
    setNotAllowed(null);
    const { data, error } = await supabase
      .from('photos')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      // RLS blocked this read -- figure out whether it's because this
      // email isn't on the list at all, or because it's been disabled.
      const { data: ownRow } = await supabase
        .from('allowed_guests')
        .select('*')
        .eq('email', session.user.email)
        .maybeSingle();
      setNotAllowed(ownRow ? 'disabled' : 'missing');
      setPhotos([]);
      setLoadingGallery(false);
      if (!ownRow) {
        const { data: reqRow } = await supabase
          .from('access_requests')
          .select('*')
          .eq('email', session.user.email)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        setExistingRequest(reqRow ? { status: reqRow.status } : null);
      }
      return;
    }
    setPhotos(data as PhotoRecord[]);
    setLoadingGallery(false);

    // fetch signed preview thumbnail urls
    for (const p of data as PhotoRecord[]) {
      const path = p.preview_path || p.original_path;
      const bucket = p.preview_path ? 'previews' : 'originals';
      const { data: signed } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 60);
      if (signed?.signedUrl) {
        setPreviewUrls((prev) => ({ ...prev, [p.id]: signed.signedUrl }));
      }
    }
  }

  // ---- Messaging: directory, groups, threads, photo comments ----
  async function loadDirectory() {
    const { data, error } = await supabase.from('allowed_guests').select('email,name,is_disabled');
    if (error || !data) return;
    setDirectory(
      (data as any[])
        .filter((g) => !g.is_disabled && g.email !== session.user.email)
        .map((g) => ({ email: g.email, name: g.name || g.email }))
    );
  }

  async function loadGroups() {
    const { data: memberRows, error: memberErr } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('email', session.user.email);
    if (memberErr || !memberRows || memberRows.length === 0) {
      setGroups([]);
      return;
    }
    const ids = memberRows.map((r: any) => r.group_id);
    const { data, error } = await supabase.from('groups').select('*').in('id', ids);
    if (error || !data) return;
    setGroups(data as GroupRecord[]);
  }

  function nameFor(email: string) {
    if (email === session.user.email) return 'You';
    return directory.find((d) => d.email === email)?.name || email;
  }

  async function openThread(ref: ThreadRef) {
    setMessagesError('');
    setSelectedThread(ref);
    setThreadMessages([]);
    if (ref.type === 'dm') {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .is('group_id', null)
        .is('photo_id', null)
        .or(
          `and(sender_email.eq.${session.user.email},recipient_email.eq.${ref.id}),and(sender_email.eq.${ref.id},recipient_email.eq.${session.user.email})`
        )
        .order('created_at', { ascending: true });
      if (error) {
        setMessagesError(error.message);
        return;
      }
      setThreadMessages((data as MessageRecord[]) || []);
    } else {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('group_id', ref.id)
        .order('created_at', { ascending: true });
      if (error) {
        setMessagesError(error.message);
        return;
      }
      setThreadMessages((data as MessageRecord[]) || []);
    }
  }

  async function sendThreadMessage(e: React.FormEvent) {
    e.preventDefault();
    const body = newMessageBody.trim();
    if (!body || !selectedThread) return;
    const row: any = { sender_email: session.user.email, body };
    if (selectedThread.type === 'dm') row.recipient_email = selectedThread.id;
    else row.group_id = selectedThread.id;
    const { error } = await supabase.from('messages').insert(row);
    if (error) {
      setMessagesError(error.message);
      return;
    }
    setNewMessageBody('');
    openThread(selectedThread);
  }

  function toggleGroupMember(email: string) {
    setNewGroupMembers((prev) => (prev.includes(email) ? prev.filter((x) => x !== email) : [...prev, email]));
  }

  async function createGroup(e: React.FormEvent) {
    e.preventDefault();
    setMessagesError('');
    const name = newGroupName.trim();
    if (!name) {
      setMessagesError('Give the group a name.');
      return;
    }
    const { data, error } = await supabase
      .from('groups')
      .insert({ name, created_by: session.user.email })
      .select()
      .single();
    if (error || !data) {
      setMessagesError(error?.message || 'Could not create group.');
      return;
    }
    const memberRows = [session.user.email, ...newGroupMembers].map((email) => ({
      group_id: data.id,
      email,
    }));
    await supabase.from('group_members').insert(memberRows);
    setNewGroupName('');
    setNewGroupMembers([]);
    setShowNewGroupForm(false);
    loadGroups();
  }

  async function loadPhotoComments(photoId: string) {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('photo_id', photoId)
      .order('created_at', { ascending: true });
    if (error || !data) return;
    setPhotoComments(data as MessageRecord[]);
  }

  async function sendPhotoComment(e: React.FormEvent) {
    e.preventDefault();
    const body = newCommentBody.trim();
    if (!body || !lightbox) return;
    const { error } = await supabase
      .from('messages')
      .insert({ sender_email: session.user.email, photo_id: lightbox.id, body });
    if (!error) {
      setNewCommentBody('');
      loadPhotoComments(lightbox.id);
    }
  }

  function startEditMessage(m: MessageRecord) {
    setEditingMessageId(m.id);
    setEditMessageBody(m.body);
  }

  function cancelEditMessage() {
    setEditingMessageId(null);
    setEditMessageBody('');
  }

  async function saveEditMessage(m: MessageRecord) {
    const body = editMessageBody.trim();
    if (!body) return;
    const { error } = await supabase.from('messages').update({ body }).eq('id', m.id);
    if (error) {
      setMessagesError(error.message);
      return;
    }
    setThreadMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, body } : x)));
    setEditingMessageId(null);
  }

  async function deleteMessage(m: MessageRecord) {
    const ok = window.confirm("Delete this message? This can't be undone.");
    if (!ok) return;
    const { error } = await supabase.from('messages').delete().eq('id', m.id);
    if (!error) {
      setThreadMessages((prev) => prev.filter((x) => x.id !== m.id));
    }
  }

  function startEditComment(c: MessageRecord) {
    setEditingCommentId(c.id);
    setEditCommentBody(c.body);
  }

  function cancelEditComment() {
    setEditingCommentId(null);
    setEditCommentBody('');
  }

  async function saveEditComment(c: MessageRecord) {
    const body = editCommentBody.trim();
    if (!body) return;
    const { error } = await supabase.from('messages').update({ body }).eq('id', c.id);
    if (!error) {
      setPhotoComments((prev) => prev.map((x) => (x.id === c.id ? { ...x, body } : x)));
      setEditingCommentId(null);
    }
  }

  async function deleteComment(c: MessageRecord) {
    const ok = window.confirm("Delete this comment? This can't be undone.");
    if (!ok) return;
    const { error } = await supabase.from('messages').delete().eq('id', c.id);
    if (!error) {
      setPhotoComments((prev) => prev.filter((x) => x.id !== c.id));
    }
  }

  function currentGroup(): GroupRecord | undefined {
    return selectedThread?.type === 'group' ? groups.find((g) => g.id === selectedThread.id) : undefined;
  }

  function startRenameGroup() {
    const g = currentGroup();
    if (!g) return;
    setRenamingGroup(true);
    setRenameGroupName(g.name);
  }

  function cancelRenameGroup() {
    setRenamingGroup(false);
    setRenameGroupName('');
  }

  async function saveRenameGroup() {
    const g = currentGroup();
    if (!g) return;
    const name = renameGroupName.trim();
    if (!name) return;
    const { error } = await supabase.from('groups').update({ name }).eq('id', g.id);
    if (error) {
      setMessagesError(error.message);
      return;
    }
    setGroups((prev) => prev.map((x) => (x.id === g.id ? { ...x, name } : x)));
    setSelectedThread((prev) => (prev ? { ...prev, label: name } : prev));
    setRenamingGroup(false);
  }

  async function deleteGroup() {
    const g = currentGroup();
    if (!g) return;
    const ok = window.confirm(`Delete the group "${g.name}"? This removes it for everyone and can't be undone.`);
    if (!ok) return;
    const { error } = await supabase.from('groups').delete().eq('id', g.id);
    if (error) {
      setMessagesError(error.message);
      return;
    }
    setGroups((prev) => prev.filter((x) => x.id !== g.id));
    setSelectedThread(null);
    setThreadMessages([]);
  }

  // ---- My Photos: folders ----
  async function loadFolders() {
    const { data, error } = await supabase
      .from('photo_folders')
      .select('*')
      .order('created_at', { ascending: true });
    if (error || !data) return;
    setFolders((data as any[]).map((f) => ({ id: f.id, name: f.name })));
  }

  async function createFolder(e: React.FormEvent) {
    e.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;
    const { error } = await supabase
      .from('photo_folders')
      .insert({ owner_email: session.user.email, name });
    if (!error) {
      setNewFolderName('');
      loadFolders();
    }
  }

  function startRenameFolder(f: { id: string; name: string }) {
    setRenamingFolderId(f.id);
    setRenameFolderName(f.name);
  }

  async function saveRenameFolder() {
    const name = renameFolderName.trim();
    if (!name || !renamingFolderId) return;
    const { error } = await supabase
      .from('photo_folders')
      .update({ name })
      .eq('id', renamingFolderId);
    if (!error) {
      setFolders((prev) => prev.map((f) => (f.id === renamingFolderId ? { ...f, name } : f)));
      setRenamingFolderId(null);
    }
  }

  async function deleteFolder(folderId: string) {
    const ok = window.confirm(
      "Delete this folder? The photos inside will stay in the gallery — only the folder organization goes away."
    );
    if (!ok) return;
    const { error } = await supabase.from('photo_folders').delete().eq('id', folderId);
    if (!error) {
      setFolders((prev) => prev.filter((f) => f.id !== folderId));
      if (activeFolderId === folderId) {
        setActiveFolderId(null);
        setFolderPhotoIds([]);
      }
    }
  }

  async function openFolder(folderId: string) {
    setActiveFolderId(folderId);
    const { data, error } = await supabase
      .from('folder_photos')
      .select('photo_id')
      .eq('folder_id', folderId);
    if (error || !data) return;
    setFolderPhotoIds((data as any[]).map((r) => r.photo_id));
  }

  async function addPhotoToFolder(photoId: string, folderId: string) {
    const { error } = await supabase
      .from('folder_photos')
      .insert({ folder_id: folderId, photo_id: photoId });
    if (!error && activeFolderId === folderId) {
      setFolderPhotoIds((prev) => (prev.includes(photoId) ? prev : [...prev, photoId]));
    }
  }

  async function removePhotoFromFolder(photoId: string, folderId: string) {
    await supabase.from('folder_photos').delete().eq('folder_id', folderId).eq('photo_id', photoId);
    setFolderPhotoIds((prev) => prev.filter((id) => id !== photoId));
  }

  function handlePhotoDragStart(e: React.DragEvent, photoId: string) {
    e.dataTransfer.setData('text/plain', photoId);
  }

  function handleFolderDrop(e: React.DragEvent, folderId: string) {
    e.preventDefault();
    setDragOverFolderId(null);
    const photoId = e.dataTransfer.getData('text/plain');
    if (photoId) addPhotoToFolder(photoId, folderId);
  }

  // ---- Site layout settings ----
  async function loadSiteSettings() {
    const { data, error } = await supabase.from('site_settings').select('*').eq('id', 1).maybeSingle();
    if (error || !data) return;
    if (Array.isArray(data.section_order) && data.section_order.length === 4) {
      setSectionOrder(data.section_order);
    }
    if (data.default_sort) {
      setSortOrder(data.default_sort as any);
      setLayoutSort(data.default_sort as any);
    }
  }

  function moveSectionUp(key: string) {
    setSectionOrder((prev) => {
      const idx = prev.indexOf(key);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
    setLayoutSaved(false);
  }

  function moveSectionDown(key: string) {
    setSectionOrder((prev) => {
      const idx = prev.indexOf(key);
      if (idx === -1 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
      return next;
    });
    setLayoutSaved(false);
  }

  async function saveLayoutSettings() {
    const { error } = await supabase
      .from('site_settings')
      .update({ default_sort: layoutSort, section_order: sectionOrder, updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (!error) {
      setSortOrder(layoutSort);
      setLayoutSaved(true);
    }
  }

  const sectionLabels: Record<string, string> = {
    upload: 'Upload box',
    gallery: 'Gallery & filters',
    messages: 'Messages panel',
    myphotos: 'My Photos panel',
  };

  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteStatus, setInviteStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [inviteErrorMsg, setInviteErrorMsg] = useState('');

  async function sendInviteEmail(e: React.FormEvent) {
    e.preventDefault();
    setInviteErrorMsg('');
    if (!CONFIG.INVITE_WEBHOOK_URL) {
      setInviteErrorMsg('The invite webhook isn\'t set up yet — add the Zapier URL to CONFIG.INVITE_WEBHOOK_URL.');
      return;
    }
    const name = inviteName.trim();
    const email = inviteEmail.trim();
    if (!name || !email) return;
    setInviteStatus('sending');
    try {
      await fetch(CONFIG.INVITE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, site_url: CONFIG.SITE_URL }),
      });
      setInviteStatus('sent');
      setInviteName('');
      setInviteEmail('');
    } catch {
      setInviteStatus('error');
    }
  }

  async function toggleGuestDisabled(email: string, current: boolean) {
    if (email === session.user.email) {
      setGuestError("You can't disable yourself.");
      return;
    }
    await supabase.from('allowed_guests').update({ is_disabled: !current }).eq('email', email);
    loadGuestInfo();
  }

  async function toggleGuestAdmin(email: string, current: boolean) {
    if (email === session.user.email && current) {
      setGuestError("You can't remove your own admin access.");
      return;
    }
    const { error } = await supabase.from('allowed_guests').update({ is_admin: !current }).eq('email', email);
    if (error) {
      setGuestError(error.message);
      return;
    }
    loadGuestInfo();
  }

  function canEditOrDelete(p: PhotoRecord) {
    return isAdmin || p.uploader_email === session?.user?.email;
  }

  function startEdit(p: PhotoRecord) {
    setEditingPhotoId(p.id);
    setEditName(p.uploader_name);
    setEditDescription(p.description || '');
    setEditCategory(p.category || '');
  }

  function cancelEdit() {
    setEditingPhotoId(null);
  }

  async function saveEdit(p: PhotoRecord) {
    const { error } = await supabase
      .from('photos')
      .update({
        uploader_name: editName.trim() || p.uploader_name,
        description: editDescription.trim(),
        category: editCategory || null,
      })
      .eq('id', p.id);
    if (error) {
      console.error(error);
      return;
    }
    setPhotos((prev) =>
      prev.map((x) =>
        x.id === p.id
          ? { ...x, uploader_name: editName.trim() || p.uploader_name, description: editDescription.trim(), category: editCategory || null }
          : x
      )
    );
    setEditingPhotoId(null);
  }

  async function submitAccessRequest(e: React.FormEvent) {
    e.preventDefault();
    setRequestError('');
    const first = requestFirstName.trim();
    const last = requestLastName.trim();
    const email = requestEmail.trim();
    if (!first || !last || !email) {
      setRequestError('Enter your first name, last name, and email.');
      return;
    }
    const { error } = await supabase.from('access_requests').insert({
      email,
      first_name: first,
      last_name: last,
    });
    if (error) {
      setRequestError(error.message);
      return;
    }
    setRequestSubmitted(true);
    setExistingRequest({ status: 'pending' });
  }

  async function loadPendingRequests() {
    const { data, error } = await supabase
      .from('access_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error || !data) return;
    setPendingRequests(data as any);
  }

  async function approveRequest(r: { id: string; email: string; first_name: string; last_name: string }) {
    await supabase.from('allowed_guests').insert({
      email: r.email,
      name: `${r.first_name} ${r.last_name}`.trim(),
      is_admin: false,
      is_disabled: false,
    });
    await supabase.from('access_requests').update({ status: 'approved' }).eq('id', r.id);
    loadPendingRequests();
    loadGuestInfo();
  }

  async function denyRequest(r: { id: string }) {
    await supabase.from('access_requests').update({ status: 'denied' }).eq('id', r.id);
    loadPendingRequests();
  }

  async function deletePhoto(p: PhotoRecord) {
    const ok = window.confirm(
      `Delete this ${p.media_type} from ${p.uploader_name}? This can't be undone.`
    );
    if (!ok) return;
    await supabase.storage.from('originals').remove([p.original_path]);
    if (p.preview_path) {
      await supabase.storage.from('previews').remove([p.preview_path]);
    }
    await supabase.from('photos').delete().eq('id', p.id);
    setPhotos((prev) => prev.filter((x) => x.id !== p.id));
    if (lightbox?.id === p.id) {
      setLightbox(null);
      setLightboxUrl('');
    }
  }

  async function getSignedUrl(bucket: 'originals' | 'previews', path: string) {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
    if (error) {
      console.error(error);
      return '';
    }
    return data.signedUrl;
  }

  async function fileToImageSource(file: File): Promise<Blob> {
    const isHeic =
      file.type === 'image/heic' ||
      file.type === 'image/heif' ||
      /\.(heic|heif)$/i.test(file.name);
    if (!isHeic) return file;
    const { default: heic2any } = await import('heic2any');
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    return Array.isArray(converted) ? converted[0] : converted;
  }

  function resizeImageToBlob(source: Blob, maxDim: number, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not decode image'));
        img.onload = () => {
          if (!img.naturalWidth || !img.naturalHeight) {
            reject(new Error('Image decoded with zero dimensions'));
            return;
          }
          let w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
            else { w = Math.round(w * (maxDim / h)); h = maxDim; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, w, h);

          // Some browsers "succeed" at decoding formats they don't really support (e.g. HEIC)
          // but actually render a blank frame. Sample a few pixels — if they're all identical,
          // treat it as a failed decode rather than uploading a broken-looking blank preview.
          try {
            const sample = ctx.getImageData(0, 0, Math.min(w, 20), Math.min(h, 20)).data;
            let allSame = true;
            for (let i = 4; i < sample.length; i += 4) {
              if (sample[i] !== sample[0] || sample[i + 1] !== sample[1] || sample[i + 2] !== sample[2]) {
                allSame = false;
                break;
              }
            }
            if (allSame) {
              reject(new Error('Preview came out blank — likely an unsupported photo format'));
              return;
            }
          } catch {
            // If getImageData throws, just proceed and trust toBlob.
          }

          canvas.toBlob((blob) => {
            if (blob) resolve(blob); else reject(new Error('toBlob failed'));
          }, 'image/jpeg', quality);
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(source);
    });
  }

  function captureVideoThumbnail(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.src = URL.createObjectURL(file);
      video.onloadeddata = () => {
        video.currentTime = Math.min(1, (video.duration || 1) / 2);
      };
      video.onseeked = () => {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(video.src);
          if (blob) resolve(blob); else reject(new Error('thumbnail failed'));
        }, 'image/jpeg', 0.75);
      };
      video.onerror = () => reject(new Error('video load failed'));
    });
  }

  async function handleFiles(files: File[]) {
    if (!files.length || !session) return;
    const displayName = session.user.user_metadata?.display_name || session.user.email;

    for (const file of files) {
      setUploadingFiles((f) => [...f, file.name]);
      try {
        const isVideo = file.type.startsWith('video/');
        const mediaType: MediaType = isVideo ? 'video' : 'photo';
        const id = crypto.randomUUID();
        const ext = file.name.split('.').pop() || (isVideo ? 'mp4' : 'jpg');
        const originalPath = `${id}/original.${ext}`;

        // Upload full-resolution original, untouched
        const { error: origErr } = await supabase.storage
          .from('originals')
          .upload(originalPath, file, { contentType: file.type });
        if (origErr) throw origErr;

        // Generate + upload a preview (resized photo, or a captured video frame)
        let previewPath: string | null = null;
        try {
          const previewBlob = isVideo
            ? await captureVideoThumbnail(file)
            : await resizeImageToBlob(await fileToImageSource(file), MAX_PREVIEW_DIM, PREVIEW_QUALITY);
          previewPath = `${id}/preview.jpg`;
          await supabase.storage
            .from('previews')
            .upload(previewPath, previewBlob, { contentType: 'image/jpeg' });
        } catch (previewErr) {
          console.warn('Preview generation failed, continuing without it', previewErr);
          previewPath = null;
        }

        const { error: insertErr } = await supabase.from('photos').insert({
          uploader_email: session.user.email,
          uploader_name: displayName,
          media_type: mediaType,
          description: batchDescription.trim(),
          category: selectedCategory || null,
          original_path: originalPath,
          preview_path: previewPath,
        });
        if (insertErr) throw insertErr;
      } catch (err) {
        console.error('Upload failed for', file.name, err);
      }
      setUploadingFiles((f) => f.filter((n) => n !== file.name));
    }
    setBatchDescription('');
    loadPhotos();
  }

  async function openLightbox(p: PhotoRecord) {
    setLightbox(p);
    setPhotoComments([]);
    setNewCommentBody('');
    const isHeic = /\.(heic|heif)$/i.test(p.original_path);
    // Most browsers (everything but Safari) can't display HEIC inline, so for viewing
    // we show the already-converted preview instead. "Download high-res" still gets
    // the real, untouched original file.
    const url =
      isHeic && p.preview_path
        ? await getSignedUrl('previews', p.preview_path)
        : await getSignedUrl('originals', p.original_path);
    setLightboxUrl(url);
    loadPhotoComments(p.id);
  }

  // ---- Photo selection (for building a custom slideshow) ----
  function togglePhotoSelected(id: string) {
    setSelectedPhotoIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function selectAllVisible(list: PhotoRecord[]) {
    setSelectedPhotoIds(list.map((p) => p.id));
  }

  function clearSelection() {
    setSelectedPhotoIds([]);
  }

  function exitSelectMode() {
    setSelectMode(false);
    setSelectedPhotoIds([]);
  }

  // ---- Slideshow ----
  async function startSlideshow(photos: PhotoRecord[]) {
    if (photos.length === 0) return;
    setSlideshowPhotos(photos);
    setSlideshowIndex(0);
    setSlideshowPlaying(true);
  }

  function closeSlideshow() {
    setSlideshowPhotos(null);
    setSlideshowUrl('');
  }

  function slideshowNext() {
    setSlideshowIndex((i) => {
      if (!slideshowPhotos) return i;
      return (i + 1) % slideshowPhotos.length;
    });
  }

  function slideshowPrev() {
    setSlideshowIndex((i) => {
      if (!slideshowPhotos) return i;
      return (i - 1 + slideshowPhotos.length) % slideshowPhotos.length;
    });
  }

  useEffect(() => {
    if (!slideshowPhotos) return;
    const current = slideshowPhotos[slideshowIndex];
    if (!current) return;
    (async () => {
      const isHeic = /\.(heic|heif)$/i.test(current.original_path);
      const url =
        isHeic && current.preview_path
          ? await getSignedUrl('previews', current.preview_path)
          : await getSignedUrl('originals', current.original_path);
      setSlideshowUrl(url);
    })();
  }, [slideshowPhotos, slideshowIndex]);

  // Auto-advance timer — only for photos. Videos advance on their own "ended" event instead.
  useEffect(() => {
    if (!slideshowPhotos || !slideshowPlaying) return;
    const current = slideshowPhotos[slideshowIndex];
    if (!current || current.media_type === 'video') return;
    const timer = setTimeout(() => slideshowNext(), 4000);
    return () => clearTimeout(timer);
  }, [slideshowPhotos, slideshowIndex, slideshowPlaying]);

  // Keep the video itself in sync with the Play/Pause button.
  useEffect(() => {
    if (!slideshowVideoRef.current) return;
    if (slideshowPlaying) {
      slideshowVideoRef.current.play().catch(() => {});
    } else {
      slideshowVideoRef.current.pause();
    }
  }, [slideshowPlaying, slideshowUrl]);

  async function downloadOriginal(p: PhotoRecord) {
    const url = await getSignedUrl('originals', p.original_path);
    triggerDownload(url, `anderson-wedding-${p.id}-original.${p.original_path.split('.').pop()}`);
  }

  async function downloadPreview(p: PhotoRecord) {
    if (!p.preview_path) return;
    const url = await getSignedUrl('previews', p.preview_path);
    triggerDownload(url, `anderson-wedding-${p.id}-web.jpg`);
  }

  function triggerDownload(url: string, filename: string) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  const uploaderNames = useMemo(() => {
    const set = new Set(photos.map((p) => p.uploader_name));
    return Array.from(set).sort();
  }, [photos]);

  const filteredPhotos = useMemo(() => {
    let list = [...photos];
    if (uploaderFilter !== 'all') {
      list = list.filter((p) => p.uploader_name === uploaderFilter);
    }
    if (categoryFilter !== 'all') {
      list = list.filter((p) => (p.category || '') === categoryFilter);
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.description?.toLowerCase().includes(q) ||
          p.uploader_name.toLowerCase().includes(q)
      );
    }
    if (sortOrder === 'newest') {
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    } else if (sortOrder === 'oldest') {
      list.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    } else {
      list.sort((a, b) => a.uploader_name.localeCompare(b.uploader_name));
    }
    return list;
  }, [photos, uploaderFilter, categoryFilter, searchText, sortOrder]);

  // ---------------- Render ----------------
  if (authLoading) {
    return <div className="centered-msg">Loading…</div>;
  }

  if (!session) {
    if (pendingConfirm) {
      return (
        <div className="gate-wrap">
          <div className="gate-card">
            <div className="eyebrow">You're invited</div>
            <h1>The Album</h1>
            <div className="gate-sub">
              Signing in as <strong>{pendingConfirm.email}</strong>. Click below to finish.
            </div>
            <div className="gate-error">{confirmError}</div>
            <button className="btn-primary" onClick={confirmFromLink} disabled={confirmBusy}>
              {confirmBusy ? 'Signing you in…' : 'Click to sign in'}
            </button>
            <button
              className="linklike"
              type="button"
              onClick={() => { setPendingConfirm(null); window.history.replaceState({}, '', window.location.pathname); }}
            >
              Use a different email instead
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="gate-wrap">
        {!magicLinkSent ? (
          <form className="gate-card" onSubmit={sendMagicLink}>
            <div className="eyebrow">You're invited</div>
            <h1>The Album</h1>
            <div className="gate-sub">
              Enter your email — we'll send you a code to sign in, no password needed.
            </div>
            <div className="field">
              <label>Your name</label>
              <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="e.g. Aunt Carol" />
            </div>
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder="you@example.com"
              />
            </div>
            <div className="gate-error">{authError}</div>
            <button className="btn-primary" type="submit">Send me a sign-in code</button>
          </form>
        ) : (
          <form className="gate-card" onSubmit={verifyOtpCode}>
            <div className="eyebrow">You're invited</div>
            <h1>The Album</h1>
            <div className="gate-sub">
              Check your email — enter the 6-digit code below (this works better than tapping the link,
              especially in the Gmail app).
            </div>
            <div className="field">
              <label>6-digit code</label>
              <input
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="123456"
                inputMode="numeric"
                autoFocus
              />
            </div>
            <div className="gate-error">{otpError}</div>
            <button className="btn-primary" type="submit" disabled={otpVerifying}>
              {otpVerifying ? 'Checking…' : 'Sign in'}
            </button>
            <button
              className="linklike"
              type="button"
              onClick={() => { setMagicLinkSent(false); setOtpCode(''); setOtpError(''); }}
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="eyebrow">Family album</div>
        <h1>{CONFIG.HEADLINE}</h1>
        <div className="date">{CONFIG.COUPLE} · {CONFIG.DATE}</div>
        <div className="signed-in-as">
          Signed in as {session.user.user_metadata?.display_name || session.user.email}
        </div>

        <div className="nav-pills">
          <button className="nav-pill" onClick={() => setShowHelpPanel((v) => !v)}>
            {showHelpPanel ? '✕ Close help' : '❓ How this works'}
          </button>
          <button className={'nav-pill' + (showMessagesPanel ? ' active' : '')} onClick={() => { setShowMessagesPanel((v) => { if (!v) scrollToPanel(messagesPanelRef); return !v; }); }}>
            💬 {showMessagesPanel ? 'Hide messages' : 'Messages'}
          </button>
          <button className={'nav-pill' + (showMyPhotosPanel ? ' active' : '')} onClick={() => { setShowMyPhotosPanel((v) => { if (!v) scrollToPanel(myPhotosPanelRef); return !v; }); }}>
            🖼️ {showMyPhotosPanel ? 'Hide my photos' : 'My photos'}
          </button>
          <button className="nav-pill subtle" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>

        {isAdmin && (
          <div className="admin-tools-row">
            <button className="linklike" onClick={() => setShowAdminToolsRow((v) => !v)}>
              {showAdminToolsRow ? '▴ Hide admin tools' : '▾ Admin tools'}
            </button>
            {showAdminToolsRow && (
              <div className="nav-pills admin-pills">
                <button className={'nav-pill' + (showAdminPanel ? ' active' : '')} onClick={() => setShowAdminPanel((v) => !v)}>
                  👥 {showAdminPanel ? 'Hide guest list' : 'Guest list'}
                </button>
                <button className={'nav-pill' + (showCategoryPanel ? ' active' : '')} onClick={() => setShowCategoryPanel((v) => !v)}>
                  📁 {showCategoryPanel ? 'Hide categories' : 'Categories'}
                </button>
                <button className={'nav-pill' + (showRequestsPanel ? ' active' : '')} onClick={() => setShowRequestsPanel((v) => !v)}>
                  📨 {showRequestsPanel ? 'Hide requests' : `Access requests${pendingRequests.length ? ` (${pendingRequests.length})` : ''}`}
                </button>
                <button className={'nav-pill' + (showLayoutPanel ? ' active' : '')} onClick={() => setShowLayoutPanel((v) => !v)}>
                  ⚙️ {showLayoutPanel ? 'Hide layout settings' : 'Layout settings'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {showHelpPanel && (
        <div className="admin-panel help-panel" style={{ order: -20 }}>
          <h3>How this site works</h3>
          <div className="help-grid">
            <div className="help-item">
              <div className="help-emoji">📤</div>
              <div>
                <strong>Upload photos & videos</strong>
                <p>Drag files into the box, or tap "Choose photos or videos." Add a short description and a category if you'd like.</p>
              </div>
            </div>
            <div className="help-item">
              <div className="help-emoji">🔍</div>
              <div>
                <strong>Browse & search</strong>
                <p>Use the dropdowns above the gallery to filter by person or category, search descriptions, or change the sort order.</p>
              </div>
            </div>
            <div className="help-item">
              <div className="help-emoji">💬</div>
              <div>
                <strong>Messages</strong>
                <p>Send direct messages to any guest, start a named group chat, or comment on individual photos.</p>
              </div>
            </div>
            <div className="help-item">
              <div className="help-emoji">🖼️</div>
              <div>
                <strong>My Photos & folders</strong>
                <p>See what you've uploaded, then organize favorites into folders. Folders don't delete or move the original photos — they're just for organizing.</p>
              </div>
            </div>
            <div className="help-item">
              <div className="help-emoji">⬇️</div>
              <div>
                <strong>Downloading</strong>
                <p>Every photo has "High-res" (full quality) and "Web-size" (smaller, quick to share) download buttons.</p>
              </div>
            </div>
            <div className="help-item">
              <div className="help-emoji">✏️</div>
              <div>
                <strong>Editing your own uploads</strong>
                <p>Click "Edit" on anything you uploaded to change its name, description, or category — or "Delete" to remove it.</p>
              </div>
            </div>
          </div>
          <button className="linklike" onClick={() => setShowHelpPanel(false)}>Got it, close this</button>
        </div>
      )}

      {showMessagesPanel && (
        <div ref={messagesPanelRef} className="admin-panel messages-panel" style={{ order: sectionOrder.indexOf('messages') }}>
          <h3>Messages</h3>
          <div className="messages-layout">
            <div className="thread-list">
              <div className="thread-list-heading">Direct messages</div>
              {directory.map((d) => (
                <button
                  key={d.email}
                  className={
                    'thread-item' +
                    (selectedThread?.type === 'dm' && selectedThread.id === d.email ? ' active' : '')
                  }
                  onClick={() => openThread({ type: 'dm', id: d.email, label: d.name })}
                >
                  {d.name}
                </button>
              ))}
              {directory.length === 0 && <div className="photo-desc">No other guests yet.</div>}

              <div className="thread-list-heading">Groups</div>
              {groups.map((g) => (
                <button
                  key={g.id}
                  className={
                    'thread-item' +
                    (selectedThread?.type === 'group' && selectedThread.id === g.id ? ' active' : '')
                  }
                  onClick={() => openThread({ type: 'group', id: g.id, label: g.name })}
                >
                  {g.name}
                </button>
              ))}
              <button className="linklike" onClick={() => setShowNewGroupForm((v) => !v)}>
                {showNewGroupForm ? 'Cancel' : '+ New group'}
              </button>

              {showNewGroupForm && (
                <form className="new-group-form" onSubmit={createGroup}>
                  <input
                    placeholder="Group name (e.g. Anderson Cousins)"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                  />
                  <div className="member-checkboxes">
                    {directory.map((d) => (
                      <label key={d.email} className="member-check">
                        <input
                          type="checkbox"
                          checked={newGroupMembers.includes(d.email)}
                          onChange={() => toggleGroupMember(d.email)}
                        />
                        {d.name}
                      </label>
                    ))}
                  </div>
                  <button className="btn-upload" type="submit">Create group</button>
                </form>
              )}
              {messagesError && <div className="gate-error">{messagesError}</div>}
            </div>

            <div className="thread-view">
              {!selectedThread && <div className="photo-desc">Pick a person or group to start chatting.</div>}
              {selectedThread && (
                <>
                  <div className="thread-header">
                    {selectedThread.type === 'group' && renamingGroup ? (
                      <div className="msg-edit-row">
                        <input
                          value={renameGroupName}
                          onChange={(e) => setRenameGroupName(e.target.value)}
                        />
                        <button className="linklike" onClick={saveRenameGroup}>Save</button>
                        <button className="linklike" onClick={cancelRenameGroup}>Cancel</button>
                      </div>
                    ) : (
                      <>
                        {selectedThread.label}
                        {selectedThread.type === 'group' && currentGroup()?.created_by === session.user.email && (
                          <>
                            {' '}
                            <button className="linklike" onClick={startRenameGroup}>Rename</button>
                            {' · '}
                            <button className="linklike" onClick={deleteGroup}>Delete group</button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                  <div className="thread-messages">
                    {threadMessages.map((m) => (
                      <div
                        key={m.id}
                        className={'msg-bubble' + (m.sender_email === session.user.email ? ' mine' : '')}
                      >
                        <div className="msg-sender">{nameFor(m.sender_email)}</div>
                        {editingMessageId === m.id ? (
                          <div className="msg-edit-row">
                            <input
                              value={editMessageBody}
                              onChange={(e) => setEditMessageBody(e.target.value)}
                            />
                            <button className="linklike" onClick={() => saveEditMessage(m)}>Save</button>
                            <button className="linklike" onClick={cancelEditMessage}>Cancel</button>
                          </div>
                        ) : (
                          <>
                            <div className="msg-body">{m.body}</div>
                            <div className="msg-time">
                              {new Date(m.created_at).toLocaleString()}
                              {m.sender_email === session.user.email && (
                                <>
                                  {' · '}
                                  <button className="linklike" onClick={() => startEditMessage(m)}>Edit</button>
                                  {' · '}
                                  <button className="linklike" onClick={() => deleteMessage(m)}>Delete</button>
                                </>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                    {threadMessages.length === 0 && (
                      <div className="photo-desc">No messages yet — say hi!</div>
                    )}
                  </div>
                  <form className="thread-compose" onSubmit={sendThreadMessage}>
                    <input
                      placeholder="Type a message…"
                      value={newMessageBody}
                      onChange={(e) => setNewMessageBody(e.target.value)}
                    />
                    <button className="btn-upload" type="submit">Send</button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {showMyPhotosPanel && (
        <div ref={myPhotosPanelRef} className="admin-panel myphotos-panel" style={{ order: sectionOrder.indexOf('myphotos') }}>
          <h3>My Photos</h3>

          <div className="myphotos-toolbar">
            <button
              className={'thread-item' + (myPhotosFilter === 'mine' ? ' active' : '')}
              onClick={() => { setMyPhotosFilter('mine'); setActiveFolderId(null); }}
            >
              My uploads
            </button>
            <button
              className={'thread-item' + (myPhotosFilter === 'all' && !activeFolderId ? ' active' : '')}
              onClick={() => { setMyPhotosFilter('all'); setActiveFolderId(null); }}
            >
              Everything shared with me
            </button>
          </div>

          <div className="thread-list-heading">Folders — drag any photo below onto one</div>
          <div className="folder-row">
            {folders.map((f) => (
              <div
                key={f.id}
                className={
                  'folder-chip' +
                  (activeFolderId === f.id ? ' active' : '') +
                  (dragOverFolderId === f.id ? ' drag-over' : '')
                }
                onDragOver={(e) => { e.preventDefault(); setDragOverFolderId(f.id); }}
                onDragLeave={() => setDragOverFolderId(null)}
                onDrop={(e) => handleFolderDrop(e, f.id)}
              >
                {renamingFolderId === f.id ? (
                  <div className="msg-edit-row">
                    <input value={renameFolderName} onChange={(e) => setRenameFolderName(e.target.value)} />
                    <button className="linklike" onClick={saveRenameFolder}>Save</button>
                    <button className="linklike" onClick={() => setRenamingFolderId(null)}>Cancel</button>
                  </div>
                ) : (
                  <>
                    <span onClick={() => openFolder(f.id)}>📁 {f.name}</span>
                    <button className="linklike" onClick={() => startRenameFolder(f)}>Rename</button>
                    <button className="linklike" onClick={() => deleteFolder(f.id)}>Delete</button>
                  </>
                )}
              </div>
            ))}
          </div>
          <form className="new-folder-form" onSubmit={createFolder}>
            <input
              placeholder="New folder name (e.g. Reception Highlights)"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
            />
            <button className="btn-upload" type="submit">Create folder</button>
          </form>

          <div className="thread-list-heading myphotos-heading-row">
            <span>
              {activeFolderId
                ? `In "${folders.find((f) => f.id === activeFolderId)?.name}"`
                : myPhotosFilter === 'mine'
                ? 'My uploads'
                : 'Everything shared with me'}
            </span>
            {(() => {
              const currentList = activeFolderId
                ? photos.filter((p) => folderPhotoIds.includes(p.id))
                : myPhotosFilter === 'mine'
                ? photos.filter((p) => p.uploader_email === session.user.email)
                : photos;
              return currentList.length > 0 ? (
                <button className="linklike" onClick={() => startSlideshow(currentList)}>▶️ Play slideshow</button>
              ) : null;
            })()}
          </div>
          <div className="myphotos-grid">
            {(activeFolderId
              ? photos.filter((p) => folderPhotoIds.includes(p.id))
              : myPhotosFilter === 'mine'
              ? photos.filter((p) => p.uploader_email === session.user.email)
              : photos
            ).map((p) => (
              <div
                key={p.id}
                className="myphotos-thumb"
                draggable={!activeFolderId}
                onDragStart={(e) => handlePhotoDragStart(e, p.id)}
              >
                {previewUrls[p.id] ? (
                  <img src={previewUrls[p.id]} alt={p.description || 'photo'} />
                ) : (
                  <div className="thumb-placeholder" />
                )}
                {activeFolderId && (
                  <button className="linklike" onClick={() => removePhotoFromFolder(p.id, activeFolderId)}>
                    Remove from folder
                  </button>
                )}
              </div>
            ))}
            {activeFolderId && folderPhotoIds.length === 0 && (
              <div className="photo-desc">Nothing in this folder yet — drag a photo onto it above.</div>
            )}
          </div>
        </div>
      )}

      {isAdmin && showLayoutPanel && (
        <div className="admin-panel" style={{ order: -10 }}>
          <h3>Manage layout</h3>
          <p className="photo-desc">
            Choose what every guest sees first, and the order sections appear in when opened.
          </p>

          <div className="layout-sort-row">
            <label>Default gallery sort:</label>
            <select value={layoutSort} onChange={(e) => { setLayoutSort(e.target.value as any); setLayoutSaved(false); }}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="uploader">By submitter name</option>
            </select>
          </div>

          <div className="thread-list-heading">Section order (top to bottom)</div>
          <div className="layout-order-list">
            {sectionOrder.map((key, i) => (
              <div key={key} className="layout-order-row">
                <span>{i + 1}. {sectionLabels[key]}</span>
                <div>
                  <button className="linklike" disabled={i === 0} onClick={() => moveSectionUp(key)}>Up</button>
                  {' · '}
                  <button className="linklike" disabled={i === sectionOrder.length - 1} onClick={() => moveSectionDown(key)}>Down</button>
                </div>
              </div>
            ))}
          </div>

          <button className="btn-upload" onClick={saveLayoutSettings}>Save layout</button>
          {layoutSaved && <span className="photo-desc"> Saved — this now applies to every guest.</span>}
        </div>
      )}

      {isAdmin && showAdminPanel && (
        <div className="admin-panel" style={{ order: -10 }}>
          <h3>Guest list</h3>
          <div className="guest-rows">
            {guestList.map((g) => (
              <div className="guest-row" key={g.email}>
                <span className="guest-name">{g.name}</span>
                <span className="guest-email">{g.email}</span>
                {g.is_admin && <span className="admin-badge">admin</span>}
                {g.is_disabled && <span className="disabled-badge">disabled</span>}
                {g.email !== session.user.email && (
                  <>
                    <button className="toggle-btn" onClick={() => toggleGuestAdmin(g.email, g.is_admin)}>
                      {g.is_admin ? 'Remove admin' : 'Make admin'}
                    </button>
                    <button className="toggle-btn" onClick={() => toggleGuestDisabled(g.email, g.is_disabled)}>
                      {g.is_disabled ? 'Enable' : 'Disable'}
                    </button>
                    <button className="remove-btn" onClick={() => removeGuest(g.email)}>Remove</button>
                  </>
                )}
              </div>
            ))}
          </div>
          <form className="add-guest-form" onSubmit={addGuest}>
            <input placeholder="Name" value={newGuestName} onChange={(e) => setNewGuestName(e.target.value)} />
            <input placeholder="Email" type="email" value={newGuestEmail} onChange={(e) => setNewGuestEmail(e.target.value)} />
            <button className="btn-upload" type="submit">Add to guest list</button>
          </form>
          {guestError && <div className="gate-error">{guestError}</div>}

          <div className="thread-list-heading">Send an invite email (for people who got blocked signing in)</div>
          <form className="add-guest-form" onSubmit={sendInviteEmail}>
            <input placeholder="Name" value={inviteName} onChange={(e) => setInviteName(e.target.value)} />
            <input placeholder="Email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            <button className="btn-upload" type="submit" disabled={inviteStatus === 'sending'}>
              {inviteStatus === 'sending' ? 'Sending…' : 'Send invite'}
            </button>
          </form>
          {inviteStatus === 'sent' && <div className="photo-desc">Invite sent!</div>}
          {inviteErrorMsg && <div className="gate-error">{inviteErrorMsg}</div>}
        </div>
      )}

      {isAdmin && showCategoryPanel && (
        <div className="admin-panel" style={{ order: -10 }}>
          <h3>Categories</h3>
          <div className="guest-rows">
            {categories.map((c) => (
              <div className="guest-row" key={c.id}>
                <span className="guest-name">{c.name}</span>
                <button className="remove-btn" onClick={() => removeCategory(c.id)}>Remove</button>
              </div>
            ))}
            {categories.length === 0 && <div className="photo-desc">No categories yet.</div>}
          </div>
          <form className="add-guest-form" onSubmit={addCategory}>
            <input placeholder="e.g. Ceremony" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} />
            <button className="btn-upload" type="submit">Add category</button>
          </form>
          {categoryError && <div className="gate-error">{categoryError}</div>}
        </div>
      )}

      {isAdmin && showRequestsPanel && (
        <div className="admin-panel" style={{ order: -10 }}>
          <h3>Access requests</h3>
          <div className="guest-rows">
            {pendingRequests.map((r) => (
              <div className="guest-row" key={r.id}>
                <span className="guest-name">{r.first_name} {r.last_name}</span>
                <span className="guest-email">{r.email}</span>
                <button className="toggle-btn" onClick={() => approveRequest(r)}>Approve</button>
                <button className="remove-btn" onClick={() => denyRequest(r)}>Deny</button>
              </div>
            ))}
            {pendingRequests.length === 0 && <div className="photo-desc">No pending requests.</div>}
          </div>
        </div>
      )}

      {notAllowed && (
        <div className="not-allowed">
          {notAllowed === 'disabled' ? (
            <>Your access to this album has been disabled. If that doesn't seem right, reach out to Buck at buck@heatapplied.com or 201-962-0305.</>
          ) : existingRequest?.status === 'pending' ? (
            <>Your request is in! Someone will approve it soon — check back or refresh this page after a bit.</>
          ) : existingRequest?.status === 'denied' ? (
            <>Your request wasn't approved. If you think that's a mistake, reach out to Buck at buck@heatapplied.com or 201-962-0305.</>
          ) : (
            <div className="request-form-wrap">
              <div>Your email isn't on the family guest list yet. Request access below.</div>
              <form className="add-guest-form" onSubmit={submitAccessRequest}>
                <input placeholder="First name" value={requestFirstName} onChange={(e) => setRequestFirstName(e.target.value)} />
                <input placeholder="Last name" value={requestLastName} onChange={(e) => setRequestLastName(e.target.value)} />
                <input type="email" placeholder="Email address" value={requestEmail} onChange={(e) => setRequestEmail(e.target.value)} />
                <button className="btn-upload" type="submit">Request access</button>
              </form>
              {requestError && <div className="gate-error">{requestError}</div>}
            </div>
          )}
        </div>
      )}

      {!notAllowed && (
        <>
          <div className="upload-zone" style={{ order: sectionOrder.indexOf('upload') }}>
            <div
              className={`upload-box${isDragOver ? ' dragover' : ''}`}
              onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const files = Array.from(e.dataTransfer.files || []).filter(
                  (f) => f.type.startsWith('image/') || f.type.startsWith('video/')
                );
                handleFiles(files);
              }}
            >
              <p>Drag photos or videos here, or add a description and choose files below</p>
              <input
                className="desc-input"
                placeholder="e.g. First dance"
                value={batchDescription}
                onChange={(e) => setBatchDescription(e.target.value)}
              />
              {categories.length > 0 && (
                <select
                  className="desc-input"
                  value={selectedCategory}
                  onChange={(e) => setSelectedCategory(e.target.value)}
                >
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              )}
              <button className="btn-upload" onClick={() => fileInputRef.current?.click()}>
                Choose photos or videos
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                style={{ display: 'none' }}
                onChange={(e) => {
                  handleFiles(Array.from(e.target.files || []));
                  e.target.value = '';
                }}
              />
            </div>
            {uploadingFiles.length > 0 && (
              <div className="upload-status">Uploading {uploadingFiles.join(', ')}…</div>
            )}
          </div>

          <div className="filters" style={{ order: sectionOrder.indexOf('gallery') }}>
            <select value={uploaderFilter} onChange={(e) => setUploaderFilter(e.target.value)}>
              <option value="all">Everyone</option>
              {uploaderNames.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            {categories.length > 0 && (
              <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                <option value="all">All categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
            )}
            <input
              className="search-input"
              placeholder="Search descriptions or names…"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value as any)}>
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="uploader">By submitter name</option>
            </select>
            <button className="btn-upload" onClick={() => startSlideshow(filteredPhotos)}>
              ▶️ Play slideshow
            </button>
            <button
              className={'nav-pill' + (selectMode ? ' active' : '')}
              onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
            >
              {selectMode ? '✕ Cancel selecting' : '☑️ Pick photos for a slideshow'}
            </button>
          </div>

          {selectMode && (
            <div className="select-bar">
              <span>{selectedPhotoIds.length} selected</span>
              <button className="linklike" onClick={() => selectAllVisible(filteredPhotos)}>Select All</button>
              <button className="linklike" onClick={clearSelection}>Unselect All</button>
              <button
                className="btn-upload"
                disabled={selectedPhotoIds.length === 0}
                onClick={() => startSlideshow(filteredPhotos.filter((p) => selectedPhotoIds.includes(p.id)))}
              >
                ▶️ Play selected ({selectedPhotoIds.length})
              </button>
            </div>
          )}

          <div className="gallery-wrap" style={{ order: sectionOrder.indexOf('gallery') }}>
            {loadingGallery ? (
              <div className="empty-state">Loading photos…</div>
            ) : filteredPhotos.length === 0 ? (
              <div className="empty-state">
                <h3>No photos match yet</h3>
                <div>Try a different filter, or be the first to upload above.</div>
              </div>
            ) : (
              <div className="grid">
                {filteredPhotos.map((p) => (
                  <div className={'photo-card' + (selectMode && selectedPhotoIds.includes(p.id) ? ' selected' : '')} key={p.id}>
                    <div
                      className="photo-frame"
                      onClick={() => {
                        if (selectMode) { togglePhotoSelected(p.id); return; }
                        if (editingPhotoId !== p.id) openLightbox(p);
                      }}
                    >
                      {selectMode && (
                        <input
                          type="checkbox"
                          className="select-checkbox"
                          checked={selectedPhotoIds.includes(p.id)}
                          onChange={() => togglePhotoSelected(p.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      {previewUrls[p.id] ? (
                        <img src={previewUrls[p.id]} alt={p.description || 'wedding photo'} />
                      ) : (
                        <div className="thumb-placeholder" />
                      )}
                      {p.media_type === 'video' && <div className="play-badge">▶</div>}
                    </div>

                    {editingPhotoId === p.id ? (
                      <div className="edit-form" onClick={(e) => e.stopPropagation()}>
                        <input
                          className="desc-input"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="Name"
                        />
                        <input
                          className="desc-input"
                          value={editDescription}
                          onChange={(e) => setEditDescription(e.target.value)}
                          placeholder="Description"
                        />
                        {categories.length > 0 && (
                          <select
                            className="desc-input"
                            value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}
                          >
                            <option value="">No category</option>
                            {categories.map((c) => (
                              <option key={c.id} value={c.name}>{c.name}</option>
                            ))}
                          </select>
                        )}
                        <div className="download-row">
                          <button onClick={() => saveEdit(p)}>Save</button>
                          <button onClick={cancelEdit}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="photo-meta">
                          <span className="who">{p.uploader_name}</span>
                          <span className="when">{new Date(p.created_at).toLocaleDateString()}</span>
                        </div>
                        {p.category && <div className="photo-desc">📁 {p.category}</div>}
                        {p.description && <div className="photo-desc">{p.description}</div>}
                        <div className="download-row">
                          <button onClick={() => downloadOriginal(p)}>High-res</button>
                          {p.preview_path && <button onClick={() => downloadPreview(p)}>Web-size</button>}
                        </div>
                        {canEditOrDelete(p) && (
                          <div className="download-row">
                            <button onClick={() => startEdit(p)}>Edit</button>
                            <button className="delete-photo-btn" onClick={() => deletePhoto(p)}>Delete</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => { setLightbox(null); setLightboxUrl(''); }}>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            {lightboxUrl ? (
              lightbox.media_type === 'video' ? (
                <video src={lightboxUrl} controls autoPlay style={{ maxWidth: '100%', maxHeight: '78vh' }} />
              ) : (
                <img src={lightboxUrl} alt={lightbox.description || ''} />
              )
            ) : (
              <div className="empty-state">Loading…</div>
            )}
            <div className="lightbox-meta">
              {lightbox.uploader_name} · {new Date(lightbox.created_at).toLocaleString()}
              {lightbox.category ? ` · 📁 ${lightbox.category}` : ''}
              {lightbox.description ? ` · ${lightbox.description}` : ''}
            </div>
            <div className="lightbox-actions">
              <button onClick={() => downloadOriginal(lightbox)}>Download high-res</button>
              {lightbox.preview_path && <button onClick={() => downloadPreview(lightbox)}>Download web-size</button>}
              {canEditOrDelete(lightbox) && <button className="delete-photo-btn" onClick={() => deletePhoto(lightbox)}>Delete</button>}
              <button className="close-btn" onClick={() => { setLightbox(null); setLightboxUrl(''); }}>Close</button>
            </div>

            {folders.length > 0 && (
              <div className="add-to-folder-row">
                <select value={addToFolderChoice} onChange={(e) => setAddToFolderChoice(e.target.value)}>
                  <option value="">Add to folder…</option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
                <button
                  className="btn-upload"
                  disabled={!addToFolderChoice}
                  onClick={() => { if (addToFolderChoice) addPhotoToFolder(lightbox.id, addToFolderChoice); }}
                >
                  Add
                </button>
              </div>
            )}

            <div className="lightbox-comments">
              <h4>Comments</h4>
              <div className="comment-list">
                {photoComments.map((c) => (
                  <div key={c.id} className="comment-item">
                    {editingCommentId === c.id ? (
                      <div className="msg-edit-row">
                        <input
                          value={editCommentBody}
                          onChange={(e) => setEditCommentBody(e.target.value)}
                        />
                        <button className="linklike" onClick={() => saveEditComment(c)}>Save</button>
                        <button className="linklike" onClick={cancelEditComment}>Cancel</button>
                      </div>
                    ) : (
                      <>
                        <span className="comment-sender">{nameFor(c.sender_email)}:</span> {c.body}
                        {c.sender_email === session.user.email && (
                          <>
                            {' '}
                            <button className="linklike" onClick={() => startEditComment(c)}>Edit</button>
                            {' · '}
                            <button className="linklike" onClick={() => deleteComment(c)}>Delete</button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                ))}
                {photoComments.length === 0 && <div className="photo-desc">No comments yet.</div>}
              </div>
              <form className="comment-form" onSubmit={sendPhotoComment}>
                <input
                  placeholder="Add a comment…"
                  value={newCommentBody}
                  onChange={(e) => setNewCommentBody(e.target.value)}
                />
                <button className="btn-upload" type="submit">Post</button>
              </form>
            </div>
          </div>
        </div>
      )}

      {slideshowPhotos && (
        <div className="slideshow-overlay">
          <button className="slideshow-close" onClick={closeSlideshow}>✕ Close</button>
          <div className="slideshow-stage">
            {slideshowUrl ? (
              slideshowPhotos[slideshowIndex].media_type === 'video' ? (
                <video
                  key={slideshowUrl}
                  ref={slideshowVideoRef}
                  src={slideshowUrl}
                  controls
                  autoPlay={slideshowPlaying}
                  onEnded={() => { if (slideshowPlaying) slideshowNext(); }}
                  style={{ maxWidth: '100%', maxHeight: '78vh' }}
                />
              ) : (
                <img src={slideshowUrl} alt={slideshowPhotos[slideshowIndex].description || ''} />
              )
            ) : (
              <div className="empty-state">Loading…</div>
            )}
          </div>
          <div className="slideshow-caption">
            {slideshowPhotos[slideshowIndex].uploader_name}
            {slideshowPhotos[slideshowIndex].description ? ` · ${slideshowPhotos[slideshowIndex].description}` : ''}
          </div>
          <div className="slideshow-controls">
            <button onClick={slideshowPrev}>⏮ Prev</button>
            <button onClick={() => setSlideshowPlaying((v) => !v)}>
              {slideshowPlaying ? '⏸ Pause' : '▶️ Play'}
            </button>
            <button onClick={slideshowNext}>⏭ Next</button>
            <span className="slideshow-counter">{slideshowIndex + 1} / {slideshowPhotos.length}</span>
          </div>
        </div>
      )}
    </div>
  );
}
