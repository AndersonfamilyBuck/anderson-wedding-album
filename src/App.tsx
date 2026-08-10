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

const CONFIG = {
  HEADLINE: 'Share Your Photos & Videos From The Big Day',
  COUPLE: 'The Newlyweds',
  DATE: 'August 8, 2026',
};

const MAX_PREVIEW_DIM = 1200;
const PREVIEW_QUALITY = 0.75;

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [emailInput, setEmailInput] = useState('');
  const [nameInput, setNameInput] = useState('');
  const [magicLinkSent, setMagicLinkSent] = useState(false);
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

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // ---- Load photos once signed in ----
  useEffect(() => {
    if (session) {
      loadPhotos();
      loadGuestInfo();
      loadCategories();
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

  async function toggleGuestDisabled(email: string, current: boolean) {
    if (email === session.user.email) {
      setGuestError("You can't disable yourself.");
      return;
    }
    await supabase.from('allowed_guests').update({ is_disabled: !current }).eq('email', email);
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

  function resizeImageToBlob(file: File, maxDim: number, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not decode image'));
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > maxDim || h > maxDim) {
            if (w > h) { h = Math.round(h * (maxDim / w)); w = maxDim; }
            else { w = Math.round(w * (maxDim / h)); h = maxDim; }
          }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob((blob) => {
            if (blob) resolve(blob); else reject(new Error('toBlob failed'));
          }, 'image/jpeg', quality);
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
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
            : await resizeImageToBlob(file, MAX_PREVIEW_DIM, PREVIEW_QUALITY);
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
    const url = await getSignedUrl('originals', p.original_path);
    setLightboxUrl(url);
  }

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
    return (
      <div className="gate-wrap">
        <form className="gate-card" onSubmit={sendMagicLink}>
          <div className="eyebrow">You're invited</div>
          <h1>The Album</h1>
          <div className="gate-sub">
            {magicLinkSent
              ? 'Check your email for a sign-in link.'
              : 'Enter your email — we\'ll send you a link to sign in, no password needed.'}
          </div>
          {!magicLinkSent && (
            <>
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
              <button className="btn-primary" type="submit">Send me a sign-in link</button>
            </>
          )}
        </form>
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
          {' · '}
          <button className="linklike" onClick={() => supabase.auth.signOut()}>Sign out</button>
          {isAdmin && (
            <>
              {' · '}
              <button className="linklike" onClick={() => setShowAdminPanel((v) => !v)}>
                {showAdminPanel ? 'Hide guest list' : 'Manage guest list'}
              </button>
              {' · '}
              <button className="linklike" onClick={() => setShowCategoryPanel((v) => !v)}>
                {showCategoryPanel ? 'Hide categories' : 'Manage categories'}
              </button>
              {' · '}
              <button className="linklike" onClick={() => setShowRequestsPanel((v) => !v)}>
                {showRequestsPanel ? 'Hide requests' : `Access requests${pendingRequests.length ? ` (${pendingRequests.length})` : ''}`}
              </button>
            </>
          )}
        </div>
      </div>

      {isAdmin && showAdminPanel && (
        <div className="admin-panel">
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
        </div>
      )}

      {isAdmin && showCategoryPanel && (
        <div className="admin-panel">
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
        <div className="admin-panel">
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
            <>Your access to this album has been disabled. If that doesn't seem right, reach out to whoever manages the album.</>
          ) : existingRequest?.status === 'pending' ? (
            <>Your request is in! Someone will approve it soon — check back or refresh this page after a bit.</>
          ) : existingRequest?.status === 'denied' ? (
            <>Your request wasn't approved. If you think that's a mistake, reach out to whoever manages the album directly.</>
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
          <div className="upload-zone">
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

          <div className="filters">
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
          </div>

          <div className="gallery-wrap">
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
                  <div className="photo-card" key={p.id}>
                    <div className="photo-frame" onClick={() => editingPhotoId !== p.id && openLightbox(p)}>
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
          </div>
        </div>
      )}
    </div>
  );
}
