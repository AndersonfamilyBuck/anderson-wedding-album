import { useEffect, useMemo, useState, useRef, Fragment } from 'react';
import { supabase } from './supabaseClient';

type MediaType = 'photo' | 'video';

// Some browsers don't reliably report file.type for every video format
// (.mov from iPhones being the most common case — it can come through with
// an empty type, or a type the browser doesn't recognize). Falling back to
// the file extension catches those cases so a video never gets silently
// mis-filed as a photo.
const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'avi', 'mkv', 'm4v', '3gp', 'wmv', 'ogv'];
function isVideoFile(file: File): boolean {
  if (file.type.startsWith('video/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return VIDEO_EXTENSIONS.includes(ext);
}
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff', 'tif'];
function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true;
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  return IMAGE_EXTENSIONS.includes(ext);
}
function isAcceptedMediaFile(file: File): boolean {
  return isImageFile(file) || isVideoFile(file);
}

const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = {
  // Chrome and Firefox generally refuse (or hang indefinitely on) videos
  // labeled "video/quicktime" — only Safari plays that natively. Since most
  // iPhone .mov videos use the same H.264/HEVC codec as .mp4, labeling them
  // "video/mp4" lets non-Safari browsers actually play them, even though the
  // container is technically QuickTime. Same idea as the HEIC workaround
  // below for photos.
  mov: 'video/mp4',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
  '3gp': 'video/3gpp',
  wmv: 'video/x-ms-wmv',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
};
// Some browser/OS combinations report an empty file.type for less common
// formats (.mov from iPhones especially) — and for .mov specifically, we
// deliberately override even a correctly-reported type, since "video/mp4"
// plays far more reliably outside Safari than the technically-correct
// "video/quicktime". Our own mapping wins when we have a deliberate answer;
// the browser's reported type is only used as a fallback otherwise.
function resolveContentType(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (CONTENT_TYPE_BY_EXTENSION[ext]) return CONTENT_TYPE_BY_EXTENSION[ext];
  return file.type || 'application/octet-stream';
}

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
  sort_order: number | null;
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
  shared_photo_ids?: string[] | null;
  shared_folder_name?: string | null;
}

type ThreadRef = { type: 'dm' | 'group'; id: string; label: string };

const CONFIG = {
  HEADLINE: 'Share Your Photos and Videos From The Big Day',
  COUPLE: 'The Newlyweds',
  DATE: 'August 8, 2026',
  SITE_URL: 'https://anderson-wedding-album.vercel.app',
  INVITE_WEBHOOK_URL: 'https://hooks.zapier.com/hooks/catch/28502842/46nx4f3/',
};

// Bump CURRENT_VERSION and add a new entry (newest first) any time a real update ships.
// Guests see a "🆕 What's New" badge until they've opened the panel for that version.
const CURRENT_VERSION = '4.5';
const CHANGELOG: { version: string; notes: string[] }[] = [
  {
    version: '4.5',
    notes: [
      'Fixed "Share" (sending a photo in Messages) and "Get outside link" both failing silently with no explanation when something went wrong — they now show a real error message instead of just doing nothing',
      'Outside links now stay valid for about a year instead of quietly expiring after 30 days, since the link is meant to feel permanent',
      'Added a note during upload reminding people to keep the tab open and their phone unlocked — switching apps or locking the screen can pause a large video mid-upload on some phones',
    ],
  },
  {
    version: '4.4',
    notes: [
      'Found the same "videos playing on their own" bug in a second spot: the upload screen was also showing raw video files as thumbnails before you even hit Upload, which could make Safari try to play several videos at once while just staging them. Fixed the same way as the gallery — a proper video thumbnail that doesn\'t play until tapped',
    ],
  },
  {
    version: '4.3',
    notes: [
      'Fixed a serious bug: whenever a video was missing its thumbnail, the gallery was showing the raw video file as its "thumbnail image." Some browsers (notably Safari) will actually try to decode and play video content given to an image slot — with several such videos on one page, this could spike memory badly enough to crash the whole page. Videos without a thumbnail now correctly show a plain placeholder instead',
    ],
  },
  {
    version: '4.2',
    notes: [
      'Videos in the photo/video viewer no longer autoplay — they show a preview image and start when someone taps play. Browsing through several videos in a row (or on a slower connection) no longer starts streaming each one automatically',
    ],
  },
  {
    version: '4.1',
    notes: [
      'The last fix only protected the thumbnail-generation step from hanging forever — the actual file upload itself had no such protection. Now every step of uploading a photo or video (the upload, the preview, and saving it) has its own timeout, so a stalled connection surfaces a real error instead of an endless "Uploading..." with no way out',
    ],
  },
  {
    version: '4.0',
    notes: [
      'Fixed a bug where uploading certain videos could get stuck "Uploading..." forever with no error and no way to tell what happened. If the browser can\'t generate a preview thumbnail for a video within a few seconds, the upload now continues without one instead of hanging indefinitely',
    ],
  },
  {
    version: '3.9',
    notes: [
      'Fixed videos getting stuck "loading" forever outside Safari — .mov uploads (the iPhone format) were being labeled in a way only Safari plays reliably; they now use a label that Chrome and Firefox handle correctly too. Note: this fixes new uploads going forward — a few already-uploaded test videos may need to be deleted and re-uploaded to pick up the fix',
    ],
  },
  {
    version: '3.8',
    notes: [
      'Fixed .mov videos (the standard iPhone video format) sometimes failing to upload or getting mistaken for photos — some browsers don\'t reliably report the file type for .mov, so uploads now also check the file name as a backup',
    ],
  },
  {
    version: '3.7',
    notes: [
      'Fixed a bug where a failed upload (often large videos) would silently disappear with no explanation. Failed items now stay in the upload queue with a clear error message, and can be retried without re-selecting the file',
    ],
  },
  {
    version: '3.6',
    notes: [
      'Admins can now add a guest without an email address and generate a private, one-time sign-in link for them — share it by text or open it directly on their device. Built for elderly relatives and kids who don\'t have their own email',
    ],
  },
  {
    version: '3.5',
    notes: [
      'Any signed-in guest can now invite someone new — look for "✉️ Invite someone" in the account menu (tap your initial, top right). Fill in their name and email, and it goes to admins for approval in the same "Access requests" panel used today. Admins now also see who suggested each pending request',
    ],
  },
  {
    version: '3.4',
    notes: [
      '"Browse the day" is now called "Browse the category," to better match what it actually does — jump to photos in a specific category',
      '"Browse the category" and "Recent memories" can now be reordered in Manage layout, alongside Showcase feed and Gallery & filters. Only the header and hero always stay fixed at the very top',
    ],
  },
  {
    version: '3.3',
    notes: [
      '"Manage layout" now only lists Showcase feed and Gallery & filters — the two sections that are always visible on the page. Messages panel and My Photos panel were removed from this list since they\'re separate panels a guest opens from the account menu, not sections that sit in the page order, so reordering them never visibly did anything',
    ],
  },
  {
    version: '3.2',
    notes: [
      'Fixed a bug where opening Help, What\'s New, Guest list, Categories, Access requests, Takedown requests, Manage layout, Reorder photos, or Tutorial videos made the panel jump above the header instead of opening in place',
      'Updated the "Manage layout" description to reflect that the header, hero, "Browse the day," and "Recent memories" always stay at the top — this setting only reorders the sections further down the page',
    ],
  },
  {
    version: '3.1',
    notes: [
      'Fixed the header on phones — the navigation links no longer wrap across several lines and block the top of the screen. They now tuck behind a menu (☰) button, matching how the header behaves on the desktop site',
    ],
  },
  {
    version: '3.0',
    notes: [
      'Admins now have a quick "🛠️ Admin" link in the account menu (tap your initial, top right) that jumps straight to the admin tools',
      '"Browse the day" now only shows chapters that actually have photos in them — empty categories stay tucked away until someone uploads to them',
    ],
  },
  {
    version: '2.9',
    notes: [
      'Photo cards, the filter bar, and the photo viewer got a visual refresh to match the new Heirloom Album look — cleaner cards, rounded buttons, and a tidier toolbar',
      'The photo/video viewer now supports the keyboard: press Escape to close, and the Left/Right arrow keys to move between photos',
      'Added a "View all photos" link under Browse the day and Recent memories, so it\'s easy to jump straight to the full searchable gallery',
      'My Photos thumbnails now open the full photo viewer when tapped, with the same download, share, and delete options as the main gallery (this was missing before)',
    ],
  },
  {
    version: '2.8',
    notes: [
      'New look for the home screen: a cleaner header bar up top, a welcoming hero section, "Browse the day" chapter cards you can tap to jump straight to photos from a category, and a "Recent memories" strip showing the newest uploads',
      'What\'s new, How this works, My photos, and Sign out are now tucked into a small account menu (tap the circle with your initial, top right) to keep the top of the page less cluttered',
    ],
  },
  {
    version: '2.6',
    notes: [
      'While picking photos for a slideshow, the "Play selected" bar now stays fixed at the bottom of the screen, so you never have to scroll back up to it',
    ],
  },
  {
    version: '2.5',
    notes: [
      'Every admin panel now has a "Close" button, so you don\'t have to scroll back up to hide it',
      'Guest sign-up and last-login times now show the exact time, not just the date',
    ],
  },
  {
    version: '2.4',
    notes: [
      'Fixed a bug where dropping a photo could open it in a new browser tab instead of uploading it',
      'The whole upload window now accepts a drop, not just the small dashed box inside it',
    ],
  },
  {
    version: '2.3',
    notes: [
      'The upload window is much bigger on laptop/desktop screens, so it\'s easier to see and fill in each photo\'s details',
    ],
  },
  {
    version: '2.2',
    notes: [
      'The "Add Your Photos & Videos" banner is now a drop zone — drag files right onto it',
      'After choosing photos or videos, you can now set a description and category for each one individually before uploading',
    ],
  },
  {
    version: '2.1',
    notes: [
      'A big "Add Your Photos & Videos" button now sits right at the top of the page, so it\'s impossible to miss on your first visit',
      'New filter to show just photos, or just videos',
      'Videos are now easier to spot in the gallery — a gold frame around the thumbnail, plus a brighter play icon',
    ],
  },
  {
    version: '2.0',
    notes: [
      'Reorder photos two new ways: drag a photo into place, or switch to "Click to number" and tap photos in the order you want',
    ],
  },
  {
    version: '1.9',
    notes: [
      'React to any photo with ❤️ 😂 😍 🎉 👏 — in the gallery, the full-size view, or the Recent posts feed',
      'Share a photo to a person or group in Messages',
      'Or get an outside link for a single photo — anyone with the link sees just that photo, nothing else on the site',
    ],
  },
  {
    version: '1.8',
    notes: [
      'Categories can now be put in any order you like (Categories panel → arrows)',
      'A new "By category order" gallery sort, grouped with headings',
      'Admins can set one master photo order (Reorder photos panel) — used by that sort and by slideshows',
    ],
  },
  {
    version: '1.7',
    notes: [
      'Sign-in codes now correctly show as 8 digits (matches what\'s emailed to you)',
      'Your email is remembered on this device, so it\'s already filled in next time you sign in',
      'Admins can see when each guest was invited, when they signed up, when they last logged in, and how many photos they\'ve uploaded',
      'Adding a new guest now sends their invite automatically — one step instead of two',
      'A one-click "Resend invite" button on each guest, for anyone who calls or emails needing help getting in',
      'Bigger text, buttons, and photo grid on laptop/desktop screens (phones and tablets look the same as before)',
    ],
  },
  {
    version: '1.6',
    notes: [
      'Save a slideshow (photos, order, and music) to play again anytime',
      'Share a saved slideshow with a person or group in Messages',
      'Bigger, easier-to-tap buttons throughout',
      'A "What\'s New" panel (you\'re looking at it!)',
    ],
  },
  {
    version: '1.5',
    notes: [
      'Add background music to a slideshow, with automatic timing to match the song',
      'Choose whether videos use their own sound or keep the music playing',
      'Request a photo be taken down (admins review and decide)',
    ],
  },
  {
    version: '1.4',
    notes: [
      'Play a slideshow of any selection of photos, a folder, or the whole gallery',
      'Share a whole folder of photos with someone in Messages',
      'Prev/Next arrows when viewing a photo full-size',
    ],
  },
  {
    version: '1.3',
    notes: [
      'Messages: direct messages, named groups, and comments on individual photos',
      'My Photos: see your own uploads and organize them into folders',
      'Admins can reorder the page layout and set the default photo sort',
    ],
  },
  {
    version: '1.2',
    notes: [
      'Sign in with an 8-digit code (more reliable than clicking email links)',
      'Fixed photos from iPhones (HEIC) not showing a preview',
    ],
  },
  {
    version: '1.0',
    notes: ['The album launches! Upload, browse, and download photos and videos from the wedding.'],
  },
];

const MAX_PREVIEW_DIM = 1200;
const PREVIEW_QUALITY = 0.75;

export default function App() {
  const [session, setSession] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [emailInput, setEmailInput] = useState(() => {
    try {
      return localStorage.getItem('lastSignInEmail') || '';
    } catch {
      return '';
    }
  });
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
  interface PendingUpload {
    id: string;
    file: File;
    previewUrl: string;
    description: string;
    category: string;
  }
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [uploadErrors, setUploadErrors] = useState<{ id: string; name: string; message: string }[]>([]);

  const [uploaderFilter, setUploaderFilter] = useState('all');
  const [searchText, setSearchText] = useState('');
  const [sortOrder, setSortOrder] = useState<'newest' | 'oldest' | 'uploader' | 'category'>('newest');

  const [lightbox, setLightbox] = useState<PhotoRecord | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string>('');

  const [isAdmin, setIsAdmin] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [guestList, setGuestList] = useState<{ email: string; name: string; is_admin: boolean; is_disabled: boolean; invited_at?: string | null; first_login_at?: string | null; last_login_at?: string | null; no_email?: boolean }[]>([]);
  const [uploadCounts, setUploadCounts] = useState<Record<string, number>>({});
  const [newGuestEmail, setNewGuestEmail] = useState('');
  const [newGuestName, setNewGuestName] = useState('');
  const [guestError, setGuestError] = useState('');
  const [newGuestNoEmail, setNewGuestNoEmail] = useState(false);
  const [guestLinkByEmail, setGuestLinkByEmail] = useState<Record<string, string>>({});
  const [guestLinkStatusByEmail, setGuestLinkStatusByEmail] = useState<Record<string, 'idle' | 'generating' | 'copied' | 'error'>>({});
  const [guestLinkErrorByEmail, setGuestLinkErrorByEmail] = useState<Record<string, string>>({});

  const [isDragOver, setIsDragOver] = useState(false);

  const [categories, setCategories] = useState<{ id: string; name: string; sort_order: number | null }[]>([]);
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [mediaTypeFilter, setMediaTypeFilter] = useState<'all' | 'photo' | 'video'>('all');
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

  const [pendingRequests, setPendingRequests] = useState<{ id: string; email: string; first_name: string; last_name: string; status: string; requested_by?: string | null }[]>([]);
  const [showRequestsPanel, setShowRequestsPanel] = useState(false);

  // ---- Guest-initiated "invite someone" (any signed-in guest, not just admins) ----
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteSubmitted, setInviteSubmitted] = useState(false);
  const [invitedName, setInvitedName] = useState('');
  const inviteFormRef = useRef<HTMLDivElement>(null);

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
  const [addToFolderChoice, setAddToFolderChoice] = useState('');
  const [showTakedownForm, setShowTakedownForm] = useState(false);
  const [activeShowcaseCommentId, setActiveShowcaseCommentId] = useState<string | null>(null);
  const [showcaseComments, setShowcaseComments] = useState<MessageRecord[]>([]);
  const [newShowcaseComment, setNewShowcaseComment] = useState('');
  const [takedownReason, setTakedownReason] = useState('');
  const [takedownSent, setTakedownSent] = useState(false);
  const [takedownRequests, setTakedownRequests] = useState<
    { id: string; photo_id: string; requested_by_email: string; reason: string | null; created_at: string }[]
  >([]);
  const [showTakedownPanel, setShowTakedownPanel] = useState(false);
  const [showShareFolderForm, setShowShareFolderForm] = useState(false);
  const [shareFolderTarget, setShareFolderTarget] = useState('');
  const [shareFolderSent, setShareFolderSent] = useState(false);

  const REACTION_EMOJIS = ['❤️', '😂', '😍', '🎉', '👏'];
  const [reactionsByPhoto, setReactionsByPhoto] = useState<Record<string, { counts: Record<string, number>; mine: string | null }>>({});
  const [openReactionPickerId, setOpenReactionPickerId] = useState<string | null>(null);

  const [sharingPhotoId, setSharingPhotoId] = useState<string | null>(null);
  const [sharePhotoTarget, setSharePhotoTarget] = useState('');
  const [sharePhotoSentId, setSharePhotoSentId] = useState<string | null>(null);
  const [outsideShareBusyId, setOutsideShareBusyId] = useState<string | null>(null);
  const [outsideShareUrl, setOutsideShareUrl] = useState<Record<string, string>>({});
  const [outsideShareError, setOutsideShareError] = useState<Record<string, string>>({});
  const [sharePhotoError, setSharePhotoError] = useState<Record<string, string>>({});

  const [sectionOrder, setSectionOrder] = useState<string[]>(['browse', 'recent', 'showcase', 'gallery']);
  const [showUploadPanel, setShowUploadPanel] = useState(false);
  const [showAccountMenu, setShowAccountMenu] = useState(false);
  const [showMobileNav, setShowMobileNav] = useState(false);

  const TUTORIAL_KEYS: { key: string; label: string }[] = [
    { key: 'onboarding', label: 'Getting started (shown to brand-new sign-ups)' },
    { key: 'uploading', label: 'Uploading photos & videos' },
    { key: 'messages', label: 'Messages' },
    { key: 'myphotos', label: 'My Photos & folders' },
    { key: 'slideshows', label: 'Slideshows & music' },
  ];

  const TUTORIAL_SCRIPTS: Record<string, { instruction: string; caption: string }[]> = {
    onboarding: [
      { instruction: 'Sign out, then screenshot the sign-in page with the email box empty.', caption: 'Enter your name and email to get started.' },
      { instruction: "Enter an email and screenshot the page right after tapping \"Send me a sign-in code.\"", caption: 'Check your email for an 8-digit code.' },
      { instruction: 'Screenshot the code-entry box on the sign-in page.', caption: 'Type the 8-digit code here to sign in.' },
      { instruction: 'Once signed in, screenshot the main gallery page.', caption: "You're in! This is the gallery — everyone's photos and videos live here." },
    ],
    uploading: [
      { instruction: 'Screenshot the page with the round gold upload button visible in the bottom-right corner.', caption: 'Tap this button any time to add photos or videos.' },
      { instruction: 'Click the upload button, then screenshot the panel that opens.', caption: 'Add a short description and pick a category if you want.' },
      { instruction: 'Screenshot after clicking "Choose photos or videos" — the file picker open.', caption: 'Pick one or more photos or videos from your device.' },
      { instruction: 'Screenshot the gallery right after a new upload appears.', caption: "That's it — your photo now shows up for everyone to see." },
    ],
    messages: [
      { instruction: 'Screenshot the header with the big "Messages" button visible.', caption: 'Tap "Messages" to open your inbox.' },
      { instruction: 'Open Messages and screenshot the list of names under "Direct messages."', caption: 'Tap anyone\'s name to start a private conversation.' },
      { instruction: 'Screenshot the "+ New group" button and the name/member-picker after clicking it.', caption: 'Start a named group chat with anyone you choose.' },
      { instruction: 'Open any photo and screenshot the comment box underneath it.', caption: 'You can also comment right on a specific photo.' },
    ],
    myphotos: [
      { instruction: 'Screenshot the header with the big "My photos" button visible.', caption: 'Tap "My photos" to see only what you\'ve uploaded.' },
      { instruction: 'Open My Photos and screenshot the "Folders" section with the "+ New folder" box.', caption: 'Create folders to organize your favorites.' },
      { instruction: 'Screenshot a photo being dragged onto a folder (or the "Add to folder" dropdown in the photo view on mobile).', caption: 'Drag a photo onto a folder — this only organizes it, nothing gets deleted or moved.' },
    ],
    slideshows: [
      { instruction: 'Screenshot the "▶️ Play slideshow" button in the gallery filters bar.', caption: 'Tap "Play slideshow" to watch photos one after another.' },
      { instruction: 'While a slideshow is playing, screenshot the "🎵 Add background music" button at the bottom.', caption: 'Add a song from your device — the timing adjusts to match it.' },
      { instruction: 'Screenshot the "💾 Save this slideshow" button and the name box.', caption: 'Save it to play again later, music included.' },
    ],
  };

  const [guidedKey, setGuidedKey] = useState<string | null>(null);
  const [guidedStepIndex, setGuidedStepIndex] = useState(0);
  const [guidedCaption, setGuidedCaption] = useState('');

  function startGuidedSetup(key: string) {
    const script = TUTORIAL_SCRIPTS[key];
    if (!script || script.length === 0) return;
    setGuidedKey(key);
    setGuidedStepIndex(0);
    setGuidedCaption(script[0].caption);
  }

  function cancelGuidedSetup() {
    setGuidedKey(null);
    setGuidedStepIndex(0);
    setGuidedCaption('');
  }

  function advanceGuidedSetup() {
    if (!guidedKey) return;
    const script = TUTORIAL_SCRIPTS[guidedKey];
    const nextIndex = guidedStepIndex + 1;
    if (nextIndex < script.length) {
      setGuidedStepIndex(nextIndex);
      setGuidedCaption(script[nextIndex].caption);
    } else {
      cancelGuidedSetup();
    }
  }

  const [tutorialVideos, setTutorialVideos] = useState<Record<string, { id: string; title: string; video_path: string }>>({});
  const [activeTutorialKey, setActiveTutorialKey] = useState<string | null>(null);
  const [activeTutorialUrl, setActiveTutorialUrl] = useState('');
  const [activeTutorialTitle, setActiveTutorialTitle] = useState('');
  const [showManageTutorials, setShowManageTutorials] = useState(false);
  const [showReorderPanel, setShowReorderPanel] = useState(false);
  const [uploadingTutorialKey, setUploadingTutorialKey] = useState<string | null>(null);
  const tutorialFileInputRef = useRef<HTMLInputElement>(null);
  const tutorialSlideFileInputRef = useRef<HTMLInputElement>(null);
  const [tutorialSlidesMap, setTutorialSlidesMap] = useState<Record<string, { id: string; step_order: number; image_path: string; caption: string }[]>>({});
  const [activeTutorialSlides, setActiveTutorialSlides] = useState<{ id: string; image_path: string; caption: string }[] | null>(null);
  const [activeTutorialSlideIndex, setActiveTutorialSlideIndex] = useState(0);
  const [activeTutorialSlideUrl, setActiveTutorialSlideUrl] = useState('');
  const [activeTutorialSlidePlaying, setActiveTutorialSlidePlaying] = useState(true);
  const [newSlideCaption, setNewSlideCaption] = useState('');
  const [addingSlideForKey, setAddingSlideForKey] = useState<string | null>(null);
  const [showLayoutPanel, setShowLayoutPanel] = useState(false);
  const [showAdminToolsRow, setShowAdminToolsRow] = useState(false);
  const [showHelpPanel, setShowHelpPanel] = useState(false);
  const [showWhatsNewPanel, setShowWhatsNewPanel] = useState(false);
  const [hasUnseenUpdate, setHasUnseenUpdate] = useState(false);

  // Public single-photo share links (?share=<id>) work without signing in --
  // this checks for that on load, before anything auth-related happens.
  const [sharedView, setSharedView] = useState<{ status: 'checking' | 'none' | 'ready' | 'error'; data?: any }>({ status: 'checking' });

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('share');
    if (!token) {
      setSharedView({ status: 'none' });
      return;
    }
    supabase
      .from('photo_shares')
      .select('*')
      .eq('id', token)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) {
          setSharedView({ status: 'error' });
        } else {
          setSharedView({ status: 'ready', data });
        }
      });
  }, []);

  useEffect(() => {
    const lastSeen = window.localStorage.getItem('lastSeenVersion');
    setHasUnseenUpdate(lastSeen !== CURRENT_VERSION);
  }, []);

  // Dragging a file anywhere on the page opens the upload panel automatically,
  // so people don't have to hunt for the button first.
  useEffect(() => {
    function handleWindowDragEnter(e: DragEvent) {
      if (e.dataTransfer?.types?.includes('Files')) {
        setShowUploadPanel(true);
      }
    }
    // Without these, dropping a file anywhere that ISN'T exactly the upload
    // box falls through to the browser's default behavior -- opening the
    // image in a new tab instead of doing nothing. Always blocking the
    // default here (and letting the upload box's own onDrop handle the
    // actual file) fixes that everywhere on the page.
    function preventDefaultDrag(e: DragEvent) {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
      }
    }
    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragover', preventDefaultDrag);
    window.addEventListener('drop', preventDefaultDrag);
    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragover', preventDefaultDrag);
      window.removeEventListener('drop', preventDefaultDrag);
    };
  }, []);

  function openWhatsNew() {
    setShowWhatsNewPanel(true);
    setHasUnseenUpdate(false);
    window.localStorage.setItem('lastSeenVersion', CURRENT_VERSION);
  }

  const [selectMode, setSelectMode] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [slideshowPhotos, setSlideshowPhotos] = useState<PhotoRecord[] | null>(null);
  const [slideshowIndex, setSlideshowIndex] = useState(0);
  const [slideshowUrl, setSlideshowUrl] = useState('');
  const [slideshowPlaying, setSlideshowPlaying] = useState(true);
  const slideshowVideoRef = useRef<HTMLVideoElement>(null);
  const slideshowMusicRef = useRef<HTMLAudioElement>(null);
  const slideshowMusicInputRef = useRef<HTMLInputElement>(null);
  const [slideshowMusicUrl, setSlideshowMusicUrl] = useState('');
  const [slideshowMusicName, setSlideshowMusicName] = useState('');
  const [slideshowMusicDuration, setSlideshowMusicDuration] = useState<number | null>(null);
  const [slideshowUseVideoSound, setSlideshowUseVideoSound] = useState(false);
  const [slideshowMusicFile, setSlideshowMusicFile] = useState<File | null>(null);
  const [savedSlideshows, setSavedSlideshows] = useState<
    { id: string; name: string; photo_ids: string[]; use_video_sound: boolean; music_path: string | null; music_name: string | null }[]
  >([]);
  const [showSaveSlideshowForm, setShowSaveSlideshowForm] = useState(false);
  const [saveSlideshowName, setSaveSlideshowName] = useState('');
  const [savingSlideshow, setSavingSlideshow] = useState(false);
  const [shareSlideshowId, setShareSlideshowId] = useState<string | null>(null);
  const [shareSlideshowTarget, setShareSlideshowTarget] = useState('');
  const [shareSlideshowSentId, setShareSlideshowSentId] = useState<string | null>(null);
  const [layoutSort, setLayoutSort] = useState<'newest' | 'oldest' | 'uploader'>('newest');
  const [layoutSaved, setLayoutSaved] = useState(false);

  const [photoComments, setPhotoComments] = useState<MessageRecord[]>([]);
  const [newCommentBody, setNewCommentBody] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const myPhotosPanelRef = useRef<HTMLDivElement>(null);
  const messagesPanelRef = useRef<HTMLDivElement>(null);
  const browseRef = useRef<HTMLDivElement>(null);
  const adminToolsRef = useRef<HTMLDivElement>(null);
  const recentRef = useRef<HTMLDivElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);

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
      loadSlideshows();
      loadTutorialVideos();
    }
  }, [session]);

  useEffect(() => {
    if (isAdmin) {
      loadPendingRequests();
      loadTakedownRequests();
    }
  }, [isAdmin]);

  async function loadTakedownRequests() {
    const { data, error } = await supabase
      .from('photo_takedown_requests')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error || !data) return;
    setTakedownRequests(data as any[]);
  }

  async function loadCategories() {
    const { data, error } = await supabase.from('categories').select('*').order('sort_order').order('name');
    if (error || !data) return;
    setCategories(data as any);
  }

  async function moveCategory(id: string, direction: 'up' | 'down') {
    const idx = categories.findIndex((c) => c.id === id);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= categories.length) return;
    const a = categories[idx];
    const b = categories[swapIdx];
    const aOrder = a.sort_order ?? Date.now();
    const bOrder = b.sort_order ?? Date.now() + 1;
    await supabase.from('categories').update({ sort_order: bOrder }).eq('id', a.id);
    await supabase.from('categories').update({ sort_order: aOrder }).eq('id', b.id);
    loadCategories();
  }

  const photoOrderList = useMemo(() => {
    return [...photos].sort((a, b) => {
      const orderDiff = (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER);
      if (orderDiff !== 0) return orderDiff;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
  }, [photos]);

  async function movePhotoOrder(id: string, direction: 'up' | 'down') {
    const idx = photoOrderList.findIndex((p) => p.id === id);
    if (idx === -1) return;
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= photoOrderList.length) return;
    const a = photoOrderList[idx];
    const b = photoOrderList[swapIdx];
    const aOrder = a.sort_order ?? Date.now();
    const bOrder = b.sort_order ?? Date.now() + 1;
    await supabase.from('photos').update({ sort_order: bOrder }).eq('id', a.id);
    await supabase.from('photos').update({ sort_order: aOrder }).eq('id', b.id);
    loadPhotos();
  }

  // Renumbers the given list 1..N and saves it in one go. Used by both
  // drag-and-drop and "click to number" so the result is always exact,
  // even if some photos never had a sort_order set before.
  async function commitPhotoOrder(orderedList: PhotoRecord[]) {
    const rows = orderedList.map((p, i) => ({ id: p.id, sort_order: i + 1 }));
    await supabase.from('photos').upsert(rows, { onConflict: 'id' });
    loadPhotos();
  }

  const [dragPhotoId, setDragPhotoId] = useState<string | null>(null);

  function dropPhotoOnto(targetId: string) {
    if (!dragPhotoId || dragPhotoId === targetId) {
      setDragPhotoId(null);
      return;
    }
    const list = [...photoOrderList];
    const fromIdx = list.findIndex((p) => p.id === dragPhotoId);
    const toIdx = list.findIndex((p) => p.id === targetId);
    setDragPhotoId(null);
    if (fromIdx === -1 || toIdx === -1) return;
    const [moved] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, moved);
    commitPhotoOrder(list);
  }

  const [reorderMode, setReorderMode] = useState<'list' | 'click'>('list');
  const [clickOrderMap, setClickOrderMap] = useState<Record<string, number>>({});
  const clickCounterRef = useRef(0);

  const clickedOrder = useMemo(
    () => Object.entries(clickOrderMap).sort((a, b) => a[1] - b[1]).map(([id]) => id),
    [clickOrderMap]
  );

  function handleClickNumber(photoId: string) {
    setClickOrderMap((prev) => {
      if (prev[photoId] != null) {
        const next = { ...prev };
        delete next[photoId];
        return next;
      }
      clickCounterRef.current += 1;
      return { ...prev, [photoId]: clickCounterRef.current };
    });
  }

  function resetClickOrder() {
    setClickOrderMap({});
    clickCounterRef.current = 0;
  }

  function saveClickOrder() {
    const clickedSet = new Set(clickedOrder);
    const clickedPhotos = clickedOrder.map((id) => photoOrderList.find((p) => p.id === id)).filter(Boolean) as PhotoRecord[];
    const remaining = photoOrderList.filter((p) => !clickedSet.has(p.id));
    commitPhotoOrder([...clickedPhotos, ...remaining]);
    resetClickOrder();
    setReorderMode('list');
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

    // Count uploads per guest email so the guest list can show "X uploads"
    const { data: photoRows } = await supabase.from('photos').select('uploader_email');
    if (photoRows) {
      const counts: Record<string, number> = {};
      for (const row of photoRows as { uploader_email: string }[]) {
        counts[row.uploader_email] = (counts[row.uploader_email] || 0) + 1;
      }
      setUploadCounts(counts);
    }
  }

  async function addGuest(e: React.FormEvent) {
    e.preventDefault();
    setGuestError('');
    const name = newGuestName.trim();
    if (!name) {
      setGuestError('Enter a name.');
      return;
    }
    let email: string;
    if (newGuestNoEmail) {
      // No real email — generate a placeholder identifier just so Supabase
      // Auth has something unique to attach a sign-in link to. Nobody ever
      // sees or types this; the admin shares a generated link instead.
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'guest';
      const suffix = Math.random().toString(16).slice(2, 6);
      email = `${slug}-${suffix}@guestlink.internal`;
    } else {
      email = newGuestEmail.trim().toLowerCase();
      if (!email) {
        setGuestError('Enter both a name and email, or check "No email" for someone without one.');
        return;
      }
    }
    const { error } = await supabase.from('allowed_guests').insert({ email, name, is_admin: false, no_email: newGuestNoEmail });
    if (error) {
      setGuestError(error.message);
      return;
    }
    setNewGuestEmail('');
    setNewGuestName('');
    setNewGuestNoEmail(false);
    loadGuestInfo();
  }

  async function generateGuestLink(email: string) {
    setGuestLinkStatusByEmail((prev) => ({ ...prev, [email]: 'generating' }));
    setGuestLinkErrorByEmail((prev) => ({ ...prev, [email]: '' }));
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;
      if (!token) throw new Error('You need to be signed in to do this.');
      const res = await fetch('/api/generate-guest-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || 'Could not generate a link.');
      setGuestLinkByEmail((prev) => ({ ...prev, [email]: body.link }));
      setGuestLinkStatusByEmail((prev) => ({ ...prev, [email]: 'idle' }));
    } catch (err: any) {
      setGuestLinkErrorByEmail((prev) => ({ ...prev, [email]: err?.message || 'Something went wrong.' }));
      setGuestLinkStatusByEmail((prev) => ({ ...prev, [email]: 'error' }));
    }
  }

  async function copyGuestLink(email: string) {
    const link = guestLinkByEmail[email];
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setGuestLinkStatusByEmail((prev) => ({ ...prev, [email]: 'copied' }));
      setTimeout(() => setGuestLinkStatusByEmail((prev) => ({ ...prev, [email]: 'idle' })), 2000);
    } catch {
      // Clipboard access can fail in some browser contexts — the link is
      // still visible on screen to copy manually.
    }
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
    try {
      localStorage.setItem('lastSignInEmail', emailInput.trim());
    } catch {
      // ignore storage errors (e.g. private browsing)
    }
    setMagicLinkSent(true);
  }

  async function verifyOtpCode(e: React.FormEvent) {
    e.preventDefault();
    setOtpError('');
    const code = otpCode.trim();
    if (!code) {
      setOtpError('Enter the 8-digit code from your email.');
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
    // Record login activity (first login + last login) using a database
    // function made specifically for this, since a regular guest updating
    // their own row directly was being silently blocked.
    await supabase.rpc('record_guest_login');
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
      if (!p.preview_path && p.media_type === 'video') {
        // No generated thumbnail exists for this video. Do NOT fall back to
        // the raw video file as an image source — some browsers (notably
        // Safari) will actually attempt to decode and play video content
        // given to an <img> tag, and with several such videos on one page
        // that can spike memory enough to get the whole page killed/reloaded.
        // Leaving this unset means the UI shows its placeholder box instead,
        // which is what already happens whenever previewUrls has no entry.
        continue;
      }
      const path = p.preview_path || p.original_path;
      const bucket = p.preview_path ? 'previews' : 'originals';
      const { data: signed } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 60);
      if (signed?.signedUrl) {
        setPreviewUrls((prev) => ({ ...prev, [p.id]: signed.signedUrl }));
      }
    }
    loadReactions();
  }

  async function loadReactions() {
    const { data, error } = await supabase.from('photo_reactions').select('photo_id, guest_email, emoji');
    if (error || !data) return;
    const grouped: Record<string, { counts: Record<string, number>; mine: string | null }> = {};
    for (const row of data as { photo_id: string; guest_email: string; emoji: string }[]) {
      if (!grouped[row.photo_id]) grouped[row.photo_id] = { counts: {}, mine: null };
      grouped[row.photo_id].counts[row.emoji] = (grouped[row.photo_id].counts[row.emoji] || 0) + 1;
      if (row.guest_email === session?.user?.email) grouped[row.photo_id].mine = row.emoji;
    }
    setReactionsByPhoto(grouped);
  }

  async function toggleReaction(photoId: string, emoji: string) {
    const mine = reactionsByPhoto[photoId]?.mine;
    if (mine === emoji) {
      await supabase.from('photo_reactions').delete().eq('photo_id', photoId).eq('guest_email', session.user.email);
    } else {
      await supabase
        .from('photo_reactions')
        .upsert({ photo_id: photoId, guest_email: session.user.email, emoji }, { onConflict: 'photo_id,guest_email' });
    }
    setOpenReactionPickerId(null);
    loadReactions();
  }

  async function sharePhotoInMessages(photoId: string, target: string) {
    if (!target) return;
    setSharePhotoError((prev) => ({ ...prev, [photoId]: '' }));
    const [targetType, targetValue] = target.split(':');
    const row: any = {
      sender_email: session.user.email,
      body: '📷 Shared a photo',
      shared_photo_ids: [photoId],
    };
    if (targetType === 'dm') row.recipient_email = targetValue;
    else row.group_id = targetValue;
    const { error } = await supabase.from('messages').insert(row);
    if (!error) {
      setSharePhotoSentId(photoId);
      setSharePhotoTarget('');
    } else {
      setSharePhotoError((prev) => ({ ...prev, [photoId]: error.message || 'Could not send. Please try again.' }));
    }
  }

  async function createOutsideShareLink(photo: PhotoRecord) {
    setOutsideShareBusyId(photo.id);
    setOutsideShareError((prev) => ({ ...prev, [photo.id]: '' }));
    const path = photo.preview_path || photo.original_path;
    const bucket = photo.preview_path ? 'previews' : 'originals';
    const { data: signed, error: signError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 60 * 24 * 365); // ~1 year, so a link that looks permanent doesn't quietly expire after a month
    if (!signed?.signedUrl) {
      setOutsideShareBusyId(null);
      setOutsideShareError((prev) => ({
        ...prev,
        [photo.id]: signError?.message || 'Could not create a link for this file.',
      }));
      return;
    }
    const { data, error } = await supabase
      .from('photo_shares')
      .insert({
        photo_id: photo.id,
        uploader_name: photo.uploader_name,
        description: photo.description,
        signed_url: signed.signedUrl,
        media_type: photo.media_type,
      })
      .select()
      .single();
    setOutsideShareBusyId(null);
    if (error || !data) {
      setOutsideShareError((prev) => ({
        ...prev,
        [photo.id]: error?.message || 'Could not save this share link. Please try again.',
      }));
      return;
    }
    const shareUrl = `${CONFIG.SITE_URL}?share=${data.id}`;
    setOutsideShareUrl((prev) => ({ ...prev, [photo.id]: shareUrl }));
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      // clipboard access may be blocked; the link is still shown on screen
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

  async function toggleShowcaseComments(photoId: string) {
    if (activeShowcaseCommentId === photoId) {
      setActiveShowcaseCommentId(null);
      return;
    }
    setActiveShowcaseCommentId(photoId);
    setNewShowcaseComment('');
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('photo_id', photoId)
      .order('created_at', { ascending: true });
    if (!error && data) setShowcaseComments(data as MessageRecord[]);
  }

  async function sendShowcaseComment(photoId: string) {
    const body = newShowcaseComment.trim();
    if (!body) return;
    const { error } = await supabase
      .from('messages')
      .insert({ sender_email: session.user.email, photo_id: photoId, body });
    if (!error) {
      setNewShowcaseComment('');
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('photo_id', photoId)
        .order('created_at', { ascending: true });
      if (data) setShowcaseComments(data as MessageRecord[]);
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

  async function shareFolderInMessages(folderId: string, folderName: string, target: string) {
    if (!target) return;
    const photoIds = folderPhotoIds;
    if (photoIds.length === 0) return;
    const [targetType, targetValue] = target.split(':');
    const row: any = {
      sender_email: session.user.email,
      body: `📁 Shared folder: ${folderName} (${photoIds.length} photo${photoIds.length === 1 ? '' : 's'})`,
      shared_photo_ids: photoIds,
      shared_folder_name: folderName,
    };
    if (targetType === 'dm') row.recipient_email = targetValue;
    else row.group_id = targetValue;
    const { error } = await supabase.from('messages').insert(row);
    if (!error) {
      setShareFolderSent(true);
      setShowShareFolderForm(false);
      setShareFolderTarget('');
    }
  }

  // ---- Saved slideshows (photos + order + music, all remembered for next time) ----
  // ---- Tutorial / how-to videos ----
  async function loadTutorialVideos() {
    const { data, error } = await supabase.from('tutorial_videos').select('*');
    if (error || !data) return;
    const map: Record<string, { id: string; title: string; video_path: string }> = {};
    for (const row of data as any[]) map[row.feature_key] = row;
    setTutorialVideos(map);
    await loadTutorialSlides();

    // First time ever for this browser: auto-show the onboarding video, if one exists.
    const seenOnboarding = window.localStorage.getItem('seenOnboardingTutorial');
    if (!seenOnboarding && map['onboarding']) {
      window.localStorage.setItem('seenOnboardingTutorial', 'true');
      openTutorial('onboarding', map);
    }
  }

  async function loadTutorialSlides() {
    const { data, error } = await supabase
      .from('tutorial_slides')
      .select('*')
      .order('step_order', { ascending: true });
    if (error || !data) return;
    const grouped: Record<string, { id: string; step_order: number; image_path: string; caption: string }[]> = {};
    for (const row of data as any[]) {
      if (!grouped[row.feature_key]) grouped[row.feature_key] = [];
      grouped[row.feature_key].push(row);
    }
    setTutorialSlidesMap(grouped);
  }

  async function openTutorial(key: string, videosMap?: Record<string, { id: string; title: string; video_path: string }>) {
    const videos = videosMap || tutorialVideos;
    const video = videos[key];
    if (video) {
      const { data } = await supabase.storage.from('tutorial_videos').createSignedUrl(video.video_path, 3600);
      if (data) {
        setActiveTutorialKey(key);
        setActiveTutorialUrl(data.signedUrl);
        setActiveTutorialTitle(video.title);
      }
      return;
    }
    const slides = tutorialSlidesMap[key];
    if (slides && slides.length > 0) {
      setActiveTutorialSlides(slides);
      setActiveTutorialSlideIndex(0);
      setActiveTutorialSlidePlaying(true);
      setActiveTutorialTitle(TUTORIAL_KEYS.find((t) => t.key === key)?.label || key);
    }
  }

  function closeTutorial() {
    setActiveTutorialKey(null);
    setActiveTutorialUrl('');
    setActiveTutorialTitle('');
    setActiveTutorialSlides(null);
    setActiveTutorialSlideUrl('');
  }

  async function addTutorialSlide(key: string, file: File, caption: string) {
    const existing = tutorialSlidesMap[key] || [];
    const nextOrder = existing.length > 0 ? Math.max(...existing.map((s) => s.step_order)) + 1 : 1;
    const path = `slides/${key}/${crypto.randomUUID()}-${file.name}`;
    const { error: uploadError } = await supabase.storage.from('tutorial_videos').upload(path, file);
    if (uploadError) {
      window.alert(`Couldn't upload the screenshot: ${uploadError.message}`);
      return;
    }
    const { error: insertError } = await supabase.from('tutorial_slides').insert({
      feature_key: key,
      step_order: nextOrder,
      image_path: path,
      caption,
    });
    if (insertError) {
      window.alert(`Screenshot uploaded, but saving it failed: ${insertError.message}`);
      return;
    }
    loadTutorialSlides();
  }

  async function deleteTutorialSlide(slideId: string, imagePath: string) {
    await supabase.storage.from('tutorial_videos').remove([imagePath]);
    await supabase.from('tutorial_slides').delete().eq('id', slideId);
    loadTutorialSlides();
  }

  async function moveTutorialSlide(key: string, slideId: string, direction: -1 | 1) {
    const slides = [...(tutorialSlidesMap[key] || [])];
    const idx = slides.findIndex((s) => s.id === slideId);
    const swapIdx = idx + direction;
    if (idx === -1 || swapIdx < 0 || swapIdx >= slides.length) return;
    const a = slides[idx];
    const b = slides[swapIdx];
    await supabase.from('tutorial_slides').update({ step_order: b.step_order }).eq('id', a.id);
    await supabase.from('tutorial_slides').update({ step_order: a.step_order }).eq('id', b.id);
    loadTutorialSlides();
  }

  async function uploadTutorialVideo(key: string, label: string, file: File) {
    setUploadingTutorialKey(key);
    const path = `${key}/${crypto.randomUUID()}-${file.name}`;
    const existing = tutorialVideos[key];
    const { error: uploadError } = await supabase.storage.from('tutorial_videos').upload(path, file);
    if (uploadError) {
      window.alert(`Couldn't upload the video: ${uploadError.message}`);
      setUploadingTutorialKey(null);
      return;
    }
    if (existing) {
      await supabase.from('tutorial_videos').update({ title: label, video_path: path }).eq('id', existing.id);
      await supabase.storage.from('tutorial_videos').remove([existing.video_path]);
    } else {
      const { error: insertError } = await supabase.from('tutorial_videos').insert({ feature_key: key, title: label, video_path: path });
      if (insertError) window.alert(`Video uploaded, but saving it failed: ${insertError.message}`);
    }
    loadTutorialVideos();
    setUploadingTutorialKey(null);
  }

  async function deleteTutorialVideo(key: string) {
    const existing = tutorialVideos[key];
    if (!existing) return;
    const ok = window.confirm('Remove this how-to video?');
    if (!ok) return;
    await supabase.storage.from('tutorial_videos').remove([existing.video_path]);
    await supabase.from('tutorial_videos').delete().eq('id', existing.id);
    setTutorialVideos((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  // ---- Saved slideshows (photos + order + music, all remembered for next time) ----
  async function loadSlideshows() {
    const { data, error } = await supabase
      .from('slideshows')
      .select('*')
      .order('created_at', { ascending: true });
    if (error || !data) return;
    setSavedSlideshows(data as any[]);
  }

  async function saveCurrentSlideshow() {
    if (!slideshowPhotos) return;
    const name = saveSlideshowName.trim();
    if (!name) return;
    setSavingSlideshow(true);
    let musicPath: string | null = null;
    let musicName: string | null = null;
    if (slideshowMusicFile) {
      const path = `${session.user.email}/${crypto.randomUUID()}-${slideshowMusicFile.name}`;
      const { error: uploadError } = await supabase.storage.from('slideshow_music').upload(path, slideshowMusicFile);
      if (!uploadError) {
        musicPath = path;
        musicName = slideshowMusicFile.name;
      }
    }
    const { error } = await supabase.from('slideshows').insert({
      owner_email: session.user.email,
      name,
      photo_ids: slideshowPhotos.map((p) => p.id),
      use_video_sound: slideshowUseVideoSound,
      music_path: musicPath,
      music_name: musicName,
    });
    setSavingSlideshow(false);
    if (!error) {
      setShowSaveSlideshowForm(false);
      setSaveSlideshowName('');
      loadSlideshows();
    }
  }

  async function playSavedSlideshow(s: { photo_ids: string[]; use_video_sound: boolean; music_path: string | null; music_name: string | null }) {
    const ordered = s.photo_ids.map((id) => photos.find((p) => p.id === id)).filter(Boolean) as PhotoRecord[];
    if (ordered.length === 0) return;
    setSlideshowUseVideoSound(s.use_video_sound);
    if (s.music_path) {
      const { data } = await supabase.storage.from('slideshow_music').createSignedUrl(s.music_path, 3600);
      if (data) {
        setSlideshowMusicUrl(data.signedUrl);
        setSlideshowMusicName(s.music_name || 'Saved music');
        setSlideshowMusicFile(null); // it's already saved — no need to re-upload
      }
    }
    startSlideshow(ordered);
  }

  async function deleteSavedSlideshow(s: { id: string; music_path: string | null }) {
    const ok = window.confirm('Delete this saved slideshow? This only removes the saved setup, not the photos themselves.');
    if (!ok) return;
    if (s.music_path) {
      await supabase.storage.from('slideshow_music').remove([s.music_path]);
    }
    await supabase.from('slideshows').delete().eq('id', s.id);
    setSavedSlideshows((prev) => prev.filter((x) => x.id !== s.id));
  }

  async function shareSavedSlideshowInMessages(
    s: { name: string; photo_ids: string[]; use_video_sound: boolean; music_path: string | null; music_name: string | null },
    target: string
  ) {
    if (!target) return;
    const [targetType, targetValue] = target.split(':');
    const row: any = {
      sender_email: session.user.email,
      body: `🎬 Shared slideshow: ${s.name} (${s.photo_ids.length} item${s.photo_ids.length === 1 ? '' : 's'})`,
      shared_photo_ids: s.photo_ids,
      shared_folder_name: s.name,
      shared_music_path: s.music_path,
      shared_music_name: s.music_name,
      shared_use_video_sound: s.use_video_sound,
    };
    if (targetType === 'dm') row.recipient_email = targetValue;
    else row.group_id = targetValue;
    await supabase.from('messages').insert(row);
  }

  async function viewSharedSlideshowFromMessage(m: MessageRecord) {
    if (!m.shared_photo_ids || m.shared_photo_ids.length === 0) return;
    const ordered = m.shared_photo_ids.map((id) => photos.find((p) => p.id === id)).filter(Boolean) as PhotoRecord[];
    if (ordered.length === 0) return;
    setSlideshowUseVideoSound(m.shared_use_video_sound || false);
    if (m.shared_music_path) {
      const { data } = await supabase.storage.from('slideshow_music').createSignedUrl(m.shared_music_path, 3600);
      if (data) {
        setSlideshowMusicUrl(data.signedUrl);
        setSlideshowMusicName(m.shared_music_name || 'Shared music');
        setSlideshowMusicFile(null);
      }
    }
    startSlideshow(ordered);
  }

  function hasTutorial(key: string) {
    return !!tutorialVideos[key] || (tutorialSlidesMap[key]?.length || 0) > 0;
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
  // Reorderable, always-in-flow sections. (Messages panel and My Photos panel
  // are excluded — they're toggle-only overlays a guest opens from the account
  // menu, not sections that sit in the normal page order.)
  const VALID_SECTIONS = ['browse', 'recent', 'showcase', 'gallery'];
  function normalizeSectionOrder(stored: string[]): string[] {
    const filtered = stored.filter((k) => VALID_SECTIONS.includes(k));
    const missing = VALID_SECTIONS.filter((k) => !filtered.includes(k));
    return [...filtered, ...missing];
  }

  async function loadSiteSettings() {
    const { data, error } = await supabase.from('site_settings').select('*').eq('id', 1).maybeSingle();
    if (error || !data) return;
    if (Array.isArray(data.section_order)) {
      setSectionOrder(normalizeSectionOrder(data.section_order));
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
    browse: 'Browse the category',
    recent: 'Recent memories',
    showcase: 'Showcase feed',
    gallery: 'Gallery & filters',
  };

  const [inviteStatusByEmail, setInviteStatusByEmail] = useState<Record<string, 'idle' | 'sending' | 'sent' | 'error'>>({});

  async function inviteGuest(email: string, name: string) {
    if (!CONFIG.INVITE_WEBHOOK_URL) {
      setGuestError('The invite webhook isn\'t set up yet — add the Zapier URL to CONFIG.INVITE_WEBHOOK_URL.');
      return;
    }
    setInviteStatusByEmail((s) => ({ ...s, [email]: 'sending' }));
    try {
      await fetch(CONFIG.INVITE_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ name, email, site_url: CONFIG.SITE_URL }),
      });
      setInviteStatusByEmail((s) => ({ ...s, [email]: 'sent' }));
    } catch {
      setInviteStatusByEmail((s) => ({ ...s, [email]: 'error' }));
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

  async function submitInviteRequest(e: React.FormEvent) {
    e.preventDefault();
    setInviteError('');
    const first = inviteFirstName.trim();
    const last = inviteLastName.trim();
    const email = inviteEmail.trim();
    if (!first || !last || !email) {
      setInviteError('Enter their first name, last name, and email.');
      return;
    }
    setInviteSubmitting(true);
    const { error } = await supabase.from('access_requests').insert({
      email,
      first_name: first,
      last_name: last,
      requested_by: session.user.user_metadata?.display_name || session.user.email,
    });
    setInviteSubmitting(false);
    if (error) {
      setInviteError(error.message);
      return;
    }
    setInviteSubmitted(true);
    setInvitedName(first);
    setInviteFirstName('');
    setInviteLastName('');
    setInviteEmail('');
    if (isAdmin) loadPendingRequests();
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

  async function submitTakedownRequest(photo: PhotoRecord) {
    const { error } = await supabase.from('photo_takedown_requests').insert({
      photo_id: photo.id,
      requested_by_email: session.user.email,
      reason: takedownReason.trim() || null,
    });
    if (!error) {
      setTakedownSent(true);
      setShowTakedownForm(false);
      setTakedownReason('');
    }
  }

  async function approveTakedown(req: { id: string; photo_id: string }) {
    const photo = photos.find((p) => p.id === req.photo_id);
    if (!photo) {
      // Photo is already gone somehow — just clear the request.
      await supabase.from('photo_takedown_requests').delete().eq('id', req.id);
      loadTakedownRequests();
      return;
    }
    const ok = window.confirm(`Delete this photo from ${photo.uploader_name}? This can't be undone.`);
    if (!ok) return;
    await supabase.storage.from('originals').remove([photo.original_path]);
    if (photo.preview_path) {
      await supabase.storage.from('previews').remove([photo.preview_path]);
    }
    await supabase.from('photos').delete().eq('id', photo.id);
    setPhotos((prev) => prev.filter((x) => x.id !== photo.id));
    loadTakedownRequests();
  }

  async function dismissTakedown(req: { id: string }) {
    await supabase.from('photo_takedown_requests').update({ status: 'dismissed' }).eq('id', req.id);
    setTakedownRequests((prev) => prev.filter((r) => r.id !== req.id));
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

  // Wraps any promise so it can never hang forever — if it doesn't settle
  // within `ms`, it rejects with a clear message instead of leaving the
  // caller stuck waiting indefinitely (e.g. a stalled network request).
  function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${label} took too long and timed out. Check your connection and try again.`));
      }, ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  }

  function captureVideoThumbnail(file: File): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.src = URL.createObjectURL(file);

      // Some video formats/codecs can't be decoded well enough by every
      // browser to grab a frame — when that happens, none of the events
      // below ever fire and this would otherwise hang forever, freezing the
      // whole upload. This timeout guarantees we always move on (without a
      // thumbnail) instead of getting stuck.
      const timeout = setTimeout(() => {
        URL.revokeObjectURL(video.src);
        reject(new Error('timed out generating a video thumbnail'));
      }, 8000);
      function settle(fn: () => void) {
        clearTimeout(timeout);
        fn();
      }

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
          settle(() => {
            URL.revokeObjectURL(video.src);
            if (blob) resolve(blob); else reject(new Error('thumbnail failed'));
          });
        }, 'image/jpeg', 0.75);
      };
      video.onerror = () => settle(() => reject(new Error('video load failed')));
    });
  }

  function handleFiles(files: File[]) {
    if (!files.length) return;
    const staged: PendingUpload[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      description: '',
      category: '',
    }));
    setPendingUploads((prev) => [...prev, ...staged]);
  }

  function updatePendingUpload(id: string, patch: Partial<Pick<PendingUpload, 'description' | 'category'>>) {
    setPendingUploads((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function removePendingUpload(id: string) {
    setPendingUploads((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
    setUploadErrors((prev) => prev.filter((e) => e.id !== id));
  }

  function describeUploadError(err: any): string {
    const raw = (err?.message || err?.error_description || '').toString();
    const status = err?.statusCode || err?.status;
    if (status === 413 || status === '413' || /exceeded the maximum allowed size|payload too large/i.test(raw)) {
      return 'This file is larger than the server currently allows. Try a shorter clip or lower resolution — or ask an admin to raise the file size limit for the "originals" bucket in Supabase (Storage → originals → Edit bucket).';
    }
    return raw || 'Something went wrong uploading this file. Please try again.';
  }

  async function uploadPendingFiles() {
    if (!pendingUploads.length || !session) return;
    const displayName = session.user.user_metadata?.display_name || session.user.email;
    const queue = [...pendingUploads];
    const succeededIds: string[] = [];

    for (const item of queue) {
      setUploadingFiles((f) => [...f, item.file.name]);
      setUploadErrors((prev) => prev.filter((e) => e.id !== item.id));
      try {
        const isVideo = isVideoFile(item.file);
        const mediaType: MediaType = isVideo ? 'video' : 'photo';
        const id = crypto.randomUUID();
        const ext = item.file.name.split('.').pop() || (isVideo ? 'mp4' : 'jpg');
        const originalPath = `${id}/original.${ext}`;

        // Upload full-resolution original, untouched. Generous timeout since
        // large video files can legitimately take a while on a slow
        // connection — but it must still end eventually rather than hang.
        const { error: origErr } = await withTimeout(
          supabase.storage
            .from('originals')
            .upload(originalPath, item.file, { contentType: resolveContentType(item.file) }),
          120000,
          'Upload'
        );
        if (origErr) throw origErr;

        // Generate + upload a preview (resized photo, or a captured video frame)
        let previewPath: string | null = null;
        try {
          const previewBlob = isVideo
            ? await captureVideoThumbnail(item.file)
            : await resizeImageToBlob(await fileToImageSource(item.file), MAX_PREVIEW_DIM, PREVIEW_QUALITY);
          previewPath = `${id}/preview.jpg`;
          await withTimeout(
            supabase.storage.from('previews').upload(previewPath, previewBlob, { contentType: 'image/jpeg' }),
            20000,
            'Preview upload'
          );
        } catch (previewErr) {
          console.warn('Preview generation failed, continuing without it', previewErr);
          previewPath = null;
        }

        const { error: insertErr } = await withTimeout(
          supabase.from('photos').insert({
            uploader_email: session.user.email,
            uploader_name: displayName,
            media_type: mediaType,
            description: item.description.trim(),
            category: item.category || null,
            original_path: originalPath,
            preview_path: previewPath,
          }),
          20000,
          'Save'
        );
        if (insertErr) throw insertErr;

        succeededIds.push(item.id);
        URL.revokeObjectURL(item.previewUrl);
      } catch (err) {
        console.error('Upload failed for', item.file.name, err);
        setUploadErrors((prev) => [
          ...prev.filter((e) => e.id !== item.id),
          { id: item.id, name: item.file.name, message: describeUploadError(err) },
        ]);
      }
      setUploadingFiles((f) => f.filter((n) => n !== item.file.name));
    }
    // Only clear items that actually succeeded — anything that failed stays
    // in the queue (with its error shown) so it's easy to see what didn't
    // go through and retry, instead of silently disappearing.
    setPendingUploads((prev) => prev.filter((p) => !succeededIds.includes(p.id)));
    loadPhotos();
  }


  async function openLightbox(p: PhotoRecord) {
    setLightbox(p);
    setPhotoComments([]);
    setNewCommentBody('');
    setShowTakedownForm(false);
    setTakedownReason('');
    setTakedownSent(false);
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

  function lightboxStep(direction: 1 | -1) {
    if (!lightbox) return;
    const list = filteredPhotos;
    const currentIndex = list.findIndex((p) => p.id === lightbox.id);
    if (currentIndex === -1) return;
    const nextIndex = (currentIndex + direction + list.length) % list.length;
    openLightbox(list[nextIndex]);
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
    if (slideshowMusicUrl) URL.revokeObjectURL(slideshowMusicUrl);
    setSlideshowMusicUrl('');
    setSlideshowMusicName('');
    setSlideshowMusicFile(null);
    setSlideshowMusicDuration(null);
    setSlideshowUseVideoSound(false);
    setShowSaveSlideshowForm(false);
    setSaveSlideshowName('');
  }

  function handleSlideshowMusicChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (slideshowMusicUrl) URL.revokeObjectURL(slideshowMusicUrl);
    const url = URL.createObjectURL(file);
    setSlideshowMusicUrl(url);
    setSlideshowMusicName(file.name);
    setSlideshowMusicFile(file);
    setSlideshowMusicDuration(null); // filled in once the audio's metadata loads
  }

  function removeSlideshowMusic() {
    if (slideshowMusicUrl) URL.revokeObjectURL(slideshowMusicUrl);
    setSlideshowMusicUrl('');
    setSlideshowMusicName('');
    setSlideshowMusicFile(null);
    setSlideshowMusicDuration(null);
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

  // How long each photo should stay on screen. If music is playing, spread the
  // photos out so the slideshow roughly finishes when the song does — videos keep
  // their own real length, so we estimate a typical video length when doing this math
  // since we can't know exact lengths in advance without preloading every clip.
  const slideshowPhotoDurationMs = useMemo(() => {
    if (!slideshowPhotos || !slideshowMusicDuration) return 4000;
    const photoCount = slideshowPhotos.filter((p) => p.media_type !== 'video').length;
    const videoCount = slideshowPhotos.length - photoCount;
    if (photoCount === 0) return 4000;
    const assumedSecondsPerVideo = 8;
    const remainingSeconds = Math.max(slideshowMusicDuration - videoCount * assumedSecondsPerVideo, photoCount * 2);
    const perPhoto = remainingSeconds / photoCount;
    return Math.min(Math.max(perPhoto, 2), 15) * 1000;
  }, [slideshowPhotos, slideshowMusicDuration]);

  // Tutorial slides: load the current step's image + auto-advance
  useEffect(() => {
    if (!activeTutorialSlides) return;
    const current = activeTutorialSlides[activeTutorialSlideIndex];
    if (!current) return;
    (async () => {
      const { data } = await supabase.storage.from('tutorial_videos').createSignedUrl(current.image_path, 3600);
      if (data) setActiveTutorialSlideUrl(data.signedUrl);
    })();
  }, [activeTutorialSlides, activeTutorialSlideIndex]);

  useEffect(() => {
    if (!activeTutorialSlides || !activeTutorialSlidePlaying) return;
    if (activeTutorialSlideIndex >= activeTutorialSlides.length - 1) return;
    const timer = setTimeout(() => setActiveTutorialSlideIndex((i) => i + 1), 5000);
    return () => clearTimeout(timer);
  }, [activeTutorialSlides, activeTutorialSlideIndex, activeTutorialSlidePlaying]);

  // Auto-advance timer — only for photos. Videos advance on their own "ended" event instead.
  useEffect(() => {
    if (!slideshowPhotos || !slideshowPlaying) return;
    const current = slideshowPhotos[slideshowIndex];
    if (!current || current.media_type === 'video') return;
    const timer = setTimeout(() => slideshowNext(), slideshowPhotoDurationMs);
    return () => clearTimeout(timer);
  }, [slideshowPhotos, slideshowIndex, slideshowPlaying, slideshowPhotoDurationMs]);

  // Keep the video itself in sync with the Play/Pause button.
  useEffect(() => {
    if (!slideshowVideoRef.current) return;
    if (slideshowPlaying) {
      slideshowVideoRef.current.play().catch(() => {});
    } else {
      slideshowVideoRef.current.pause();
    }
  }, [slideshowPlaying, slideshowUrl]);

  // Keep the music in sync too — pausing it while a video plays if the video's
  // own sound was chosen instead, and matching the overall Play/Pause button otherwise.
  useEffect(() => {
    if (!slideshowMusicRef.current || !slideshowMusicUrl || !slideshowPhotos) return;
    const currentIsVideo = slideshowPhotos[slideshowIndex]?.media_type === 'video';
    const audio = slideshowMusicRef.current;
    if (slideshowUseVideoSound && currentIsVideo) {
      audio.pause();
    } else if (slideshowPlaying) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  }, [slideshowPlaying, slideshowIndex, slideshowMusicUrl, slideshowUseVideoSound, slideshowPhotos]);

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

  const showcasePhotos = useMemo(() => {
    return [...photos]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 12);
  }, [photos]);

  const filteredPhotos = useMemo(() => {
    let list = [...photos];
    if (uploaderFilter !== 'all') {
      list = list.filter((p) => p.uploader_name === uploaderFilter);
    }
    if (categoryFilter !== 'all') {
      list = list.filter((p) => (p.category || '') === categoryFilter);
    }
    if (mediaTypeFilter !== 'all') {
      list = list.filter((p) => p.media_type === mediaTypeFilter);
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
    } else if (sortOrder === 'category') {
      const categoryRank = new Map<string, number>();
      categories.forEach((c, i) => categoryRank.set(c.name, i));
      const rankOf = (p: PhotoRecord) => (p.category && categoryRank.has(p.category) ? categoryRank.get(p.category)! : categories.length);
      const orderOf = (p: PhotoRecord) => p.sort_order ?? Number.MAX_SAFE_INTEGER;
      list.sort((a, b) => {
        const rankDiff = rankOf(a) - rankOf(b);
        if (rankDiff !== 0) return rankDiff;
        const orderDiff = orderOf(a) - orderOf(b);
        if (orderDiff !== 0) return orderDiff;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
    } else {
      list.sort((a, b) => a.uploader_name.localeCompare(b.uploader_name));
    }
    return list;
  }, [photos, uploaderFilter, categoryFilter, mediaTypeFilter, searchText, sortOrder, categories]);

  // Keyboard support for the photo/video viewer: Escape closes, Left/Right moves.
  // Skipped while typing in a form field (e.g. the comment box or edit form) so
  // arrow keys and Escape still behave normally there.
  useEffect(() => {
    if (!lightbox) return;
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isTyping = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      if (isTyping) return;
      if (e.key === 'Escape') { setLightbox(null); setLightboxUrl(''); }
      else if (e.key === 'ArrowLeft') lightboxStep(-1);
      else if (e.key === 'ArrowRight') lightboxStep(1);
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightbox, filteredPhotos]);


  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    photos.forEach((p) => {
      const key = p.category || 'Uncategorized';
      counts[key] = (counts[key] || 0) + 1;
    });
    return counts;
  }, [photos]);

  // "Browse the category" only shows chapters that actually have photos in them —
  // empty categories (e.g. ones created but not used yet) stay hidden from guests
  // and only show up once someone uploads to them.
  const categoriesWithPhotos = useMemo(() => {
    return categories.filter((c) => (categoryCounts[c.name] || 0) > 0);
  }, [categories, categoryCounts]);

  const categoryCoverPhoto = useMemo(() => {
    const covers: Record<string, PhotoRecord> = {};
    // Iterate oldest-first so the earliest upload in a category becomes its cover.
    [...photos].reverse().forEach((p) => {
      if (p.category && !covers[p.category]) covers[p.category] = p;
    });
    return covers;
  }, [photos]);

  const recentPhotos = useMemo(() => {
    return [...photos]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10);
  }, [photos]);

  // ---------------- Render ----------------
  if (sharedView.status === 'checking') {
    return <div className="centered-msg">Loading…</div>;
  }
  if (sharedView.status === 'ready') {
    const s = sharedView.data;
    return (
      <div className="shared-photo-page">
        {s.media_type === 'video' ? (
          <video src={s.signed_url} controls autoPlay className="shared-photo-media" />
        ) : (
          <img src={s.signed_url} alt="" className="shared-photo-media" />
        )}
        <div className="shared-photo-caption">
          {s.description && <div>{s.description}</div>}
          <div className="shared-photo-credit">Shared from {CONFIG.COUPLE}'s wedding album — {s.uploader_name}</div>
        </div>
      </div>
    );
  }
  if (sharedView.status === 'error') {
    return (
      <div className="centered-msg">
        <div>This link has expired or isn't available anymore.</div>
      </div>
    );
  }

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
              Check your email — enter the 8-digit code below (this works better than tapping the link,
              especially in the Gmail app).
            </div>
            <div className="field">
              <label>8-digit code</label>
              <input
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                placeholder="12345678"
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
      <header className="site-header">
        <div className="site-header-inner">
          <div className="site-logo">{CONFIG.COUPLE}'s Album</div>
          <button
            className="site-nav-toggle"
            onClick={() => setShowMobileNav((v) => !v)}
            aria-label="Menu"
          >
            {showMobileNav ? '✕' : '☰'}
          </button>
          <nav className={'site-nav' + (showMobileNav ? ' open' : '')}>
            <div className="site-nav-links">
              <button
                className="site-nav-link"
                onClick={() => { setShowMobileNav(false); scrollToPanel(browseRef); }}
              >
                Browse the category
              </button>
              <button
                className="site-nav-link"
                onClick={() => {
                  setShowMobileNav(false);
                  setShowMessagesPanel(true);
                  scrollToPanel(messagesPanelRef);
                }}
              >
                Family messages
              </button>
              {recentPhotos.length > 0 && (
                <button
                  className="site-nav-link"
                  onClick={() => { setShowMobileNav(false); scrollToPanel(recentRef); }}
                >
                  Recent memories
                </button>
              )}
            </div>
            <button
              className="site-nav-cta"
              onClick={() => { setShowMobileNav(false); setShowUploadPanel(true); }}
            >
              Add photos
            </button>
            <div className="account-menu-wrap">
              <button className="account-menu-btn" onClick={() => setShowAccountMenu((v) => !v)} aria-label="Account menu">
                {(session.user.user_metadata?.display_name || session.user.email || '?').charAt(0).toUpperCase()}
              </button>
              {showAccountMenu && (
                <div className="account-menu-panel">
                  <div className="account-menu-email">
                    Signed in as {session.user.user_metadata?.display_name || session.user.email}
                  </div>
                  <div className="account-menu-divider" />
                  <button
                    className="account-menu-item"
                    onClick={() => { setShowAccountMenu(false); openWhatsNew(); }}
                  >
                    🆕 What's new{hasUnseenUpdate && <span className="unseen-dot" />}
                  </button>
                  <button
                    className="account-menu-item"
                    onClick={() => { setShowAccountMenu(false); setShowHelpPanel((v) => !v); }}
                  >
                    ❓ How this works
                  </button>
                  <button
                    className="account-menu-item"
                    onClick={() => {
                      setShowAccountMenu(false);
                      setShowMyPhotosPanel((v) => { if (!v) scrollToPanel(myPhotosPanelRef); return !v; });
                    }}
                  >
                    🖼️ My photos
                  </button>
                  <button
                    className="account-menu-item"
                    onClick={() => {
                      setShowAccountMenu(false);
                      setInviteSubmitted(false);
                      setInviteError('');
                      setShowInviteForm(true);
                      scrollToPanel(inviteFormRef);
                    }}
                  >
                    ✉️ Invite someone
                  </button>
                  {isAdmin && (
                    <button
                      className="account-menu-item"
                      onClick={() => {
                        setShowAccountMenu(false);
                        setShowAdminToolsRow(true);
                        scrollToPanel(adminToolsRef);
                      }}
                    >
                      🛠️ Admin
                    </button>
                  )}
                  <div className="account-menu-divider" />
                  <button className="account-menu-item" onClick={() => supabase.auth.signOut()}>Sign out</button>
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>

      <div className="hero">
        <div className="eyebrow">Family album</div>
        <h1>{CONFIG.HEADLINE}</h1>
        <div className="date">{CONFIG.COUPLE} · {CONFIG.DATE}</div>
        <div className="hero-tagline">
          A shared album for our wedding day. Add your photos and videos, see what others have shared, and leave a message.
        </div>
        <button className="hero-cta" onClick={() => setShowUploadPanel(true)}>Add photos →</button>
      </div>

      {categoriesWithPhotos.length > 0 && (
        <div ref={browseRef} className="category-grid" style={{ order: sectionOrder.indexOf('browse') }}>
          <div className="recent-grid-heading-row">
            <div className="category-grid-heading">Browse the category</div>
            <button className="view-all-link" onClick={() => { setCategoryFilter('all'); scrollToPanel(galleryRef); }}>
              View all photos →
            </button>
          </div>
          <div className="category-cards">
            {categoriesWithPhotos.map((c) => {
              const cover = categoryCoverPhoto[c.name];
              return (
                <button
                  key={c.id}
                  className="category-card"
                  onClick={() => { setCategoryFilter(c.name); scrollToPanel(galleryRef); }}
                >
                  <div className="category-card-thumb">
                    {cover && previewUrls[cover.id] ? (
                      <img src={previewUrls[cover.id]} alt="" />
                    ) : '📁'}
                  </div>
                  <div className="category-card-label">
                    <div className="category-card-name">{c.name}</div>
                    <div className="category-card-count">{categoryCounts[c.name] || 0} photos</div>
                  </div>
                </button>
              );
            })}
            <button className="category-card add-photos-card" onClick={() => setShowUploadPanel(true)}>
              <div className="category-card-label">
                <div className="category-card-name">📸 Add photos</div>
                <div className="category-card-count">Share yours</div>
              </div>
            </button>
          </div>
        </div>
      )}

      {recentPhotos.length > 0 && (
        <div ref={recentRef} className="recent-grid-section" style={{ order: sectionOrder.indexOf('recent') }}>
          <div className="recent-grid-heading-row">
            <div className="recent-grid-heading">Recent memories</div>
            <button className="view-all-link" onClick={() => { setCategoryFilter('all'); scrollToPanel(galleryRef); }}>
              View all photos →
            </button>
          </div>
          <div className="recent-grid">
            {recentPhotos.map((p) => (
              <div key={p.id} className="recent-grid-thumb" onClick={() => openLightbox(p)}>
                {previewUrls[p.id] ? (
                  <img src={previewUrls[p.id]} alt={p.description || 'wedding photo'} />
                ) : (
                  <div className="thumb-placeholder" />
                )}
                {p.media_type === 'video' && <div className="play-badge">▶</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && (
        <div ref={adminToolsRef} className="admin-tools-row">
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
              <button className={'nav-pill' + (showTakedownPanel ? ' active' : '')} onClick={() => setShowTakedownPanel((v) => !v)}>
                🚩 {showTakedownPanel ? 'Hide takedown requests' : `Takedown requests${takedownRequests.length ? ` (${takedownRequests.length})` : ''}`}
              </button>
              <button className={'nav-pill' + (showLayoutPanel ? ' active' : '')} onClick={() => setShowLayoutPanel((v) => !v)}>
                ⚙️ {showLayoutPanel ? 'Hide layout settings' : 'Layout settings'}
              </button>
              <button className={'nav-pill' + (showManageTutorials ? ' active' : '')} onClick={() => setShowManageTutorials((v) => !v)}>
                🎬 {showManageTutorials ? 'Hide tutorial videos' : 'Tutorial videos'}
              </button>
              <button className={'nav-pill' + (showReorderPanel ? ' active' : '')} onClick={() => setShowReorderPanel((v) => !v)}>
                🔀 {showReorderPanel ? 'Hide reorder photos' : 'Reorder photos'}
              </button>
            </div>
          )}
        </div>
      )}

      {showHelpPanel && (
        <div className="admin-panel help-panel">
          <h3>How this site works</h3>

          {TUTORIAL_KEYS.some((t) => hasTutorial(t.key)) && (
            <>
              <div className="help-section-title">🎬 Watch a quick tutorial</div>
              <div className="tutorial-watch-list">
                {TUTORIAL_KEYS.filter((t) => hasTutorial(t.key)).map((t) => (
                  <button key={t.key} className="btn-upload tutorial-watch-btn" onClick={() => openTutorial(t.key)}>
                    ▶️ {t.label}
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="help-section-title">Sharing photos & videos</div>
          <div className="help-grid">
            <div className="help-item">
              <div className="help-emoji">📤</div>
              <div>
                <strong>Upload</strong>
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
              <div className="help-emoji">⬇️</div>
              <div>
                <strong>Downloading</strong>
                <p>Every photo has "Download high-res" (full quality) and "Download web-size" (smaller, quick to share) buttons.</p>
              </div>
            </div>
            <div className="help-item">
              <div className="help-emoji">✏️</div>
              <div>
                <strong>Editing your own uploads</strong>
                <p>Click a photo, then "Edit" to change its description or category, or "Delete" to remove it. Admins can edit or delete anyone's upload.</p>
              </div>
            </div>
            <div className="help-item">
              <div className="help-emoji">🚩</div>
              <div>
                <strong>Request a takedown</strong>
                <p>See a photo you'd rather wasn't up? Open it and click "Request this be taken down." An admin will review it — nothing is deleted automatically.</p>
              </div>
            </div>
          </div>

          <div className="help-section-title">Messages</div>
          <div className="help-grid">
            <div className="help-item">
              <div className="help-emoji">💬</div>
              <div>
                <strong>Direct messages & groups</strong>
                <p>Click any guest's name for a private chat, or "+ New group" to start a named group conversation.</p>
              </div>
            </div>
            <div className="help-item">
              <div className="help-emoji">📷</div>
              <div>
                <strong>Photo comments</strong>
                <p>Open any photo — there's a comment box right below it for that specific photo.</p>
              </div>
            </div>
          </div>

          <div className="help-section-title">My Photos, folders & slideshows</div>
          <div className="help-grid">
            <div className="help-item">
              <div className="help-emoji">🖼️</div>
              <div>
                <strong>My Photos</strong>
                <p>Shows only what you've uploaded. Organize favorites into folders — this never deletes or moves the originals, it's just for organizing.</p>
              </div>
            </div>
            <div className="help-item">
              <div className="help-emoji">▶️</div>
              <div>
                <strong>Slideshows</strong>
                <p>Play a slideshow of the whole gallery, a folder, or hand-pick photos with "Pick photos for a slideshow." Add background music, and choose whether videos keep their own sound or your music plays through.</p>
              </div>
            </div>
            <div className="help-item">
              <div className="help-emoji">💾</div>
              <div>
                <strong>Save & share a slideshow</strong>
                <p>Save one to replay later exactly as set up, music included — or share it with someone in Messages so they can watch it too.</p>
              </div>
            </div>
          </div>

          <button className="linklike" onClick={() => setShowHelpPanel(false)}>Got it, close this</button>
        </div>
      )}

      {showInviteForm && (
        <div ref={inviteFormRef} className="admin-panel">
          <h3>Invite someone <button className="linklike panel-close-btn" onClick={() => setShowInviteForm(false)}>Close</button></h3>
          {inviteSubmitted ? (
            <>
              <p className="photo-desc">
                Thanks! We've let an admin know — once they approve it, {invitedName || 'they'} will be able to sign in.
              </p>
              <button className="linklike" onClick={() => { setInviteSubmitted(false); setShowInviteForm(false); }}>Close</button>
            </>
          ) : (
            <>
              <p className="photo-desc">
                Know someone who should be part of the family album? Fill in their name and email — an admin will review it before they're added.
              </p>
              <form className="add-guest-form" onSubmit={submitInviteRequest}>
                <input placeholder="Their first name" value={inviteFirstName} onChange={(e) => setInviteFirstName(e.target.value)} />
                <input placeholder="Their last name" value={inviteLastName} onChange={(e) => setInviteLastName(e.target.value)} />
                <input type="email" placeholder="Their email address" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                <button className="btn-upload" type="submit" disabled={inviteSubmitting}>
                  {inviteSubmitting ? 'Sending…' : 'Send invite request'}
                </button>
              </form>
              {inviteError && <div className="gate-error">{inviteError}</div>}
            </>
          )}
        </div>
      )}

      {showWhatsNewPanel && (
        <div className="admin-panel whats-new-panel">
          <h3>What's new</h3>
          <div className="changelog-list">
            {CHANGELOG.map((entry) => (
              <div key={entry.version} className="changelog-entry">
                <div className="changelog-version">Version {entry.version}</div>
                <ul>
                  {entry.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <button className="linklike" onClick={() => setShowWhatsNewPanel(false)}>Close</button>
        </div>
      )}

      {showMessagesPanel && (
        <div ref={messagesPanelRef} className="admin-panel messages-panel">
          <h3>Messages
            {hasTutorial('messages') && (
              <button className="linklike tutorial-btn" onClick={() => openTutorial('messages')}>▶️ How-to</button>
            )}
            <button className="linklike panel-close-btn" onClick={() => setShowMessagesPanel(false)}>Close</button>
          </h3>
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
                            {m.shared_photo_ids && m.shared_photo_ids.length > 0 && (
                              <button
                                className="btn-upload shared-folder-view-btn"
                                onClick={() => viewSharedSlideshowFromMessage(m)}
                              >
                                ▶️ View {m.shared_folder_name || 'shared photos'}
                                {m.shared_music_path ? ' 🎵' : ''}
                              </button>
                            )}
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
        <div ref={myPhotosPanelRef} className="admin-panel myphotos-panel">
          <h3>My Photos
            {hasTutorial('myphotos') && (
              <button className="linklike tutorial-btn" onClick={() => openTutorial('myphotos')}>▶️ How-to</button>
            )}
            <button className="linklike panel-close-btn" onClick={() => setShowMyPhotosPanel(false)}>Close</button>
          </h3>
          <p className="photo-desc myphotos-explainer">
            This shows only what <strong>you've</strong> uploaded, so you can organize your own shots into folders.
            To browse everyone's photos, use the main gallery below instead.
          </p>

          {savedSlideshows.length > 0 && (
            <>
              <div className="thread-list-heading">🎬 Saved slideshows</div>
              <div className="saved-slideshows-list">
                {savedSlideshows.map((s) => (
                  <div key={s.id} className="saved-slideshow-row">
                    <span className="saved-slideshow-name">
                      {s.name} ({s.photo_ids.length}){s.music_path ? ' 🎵' : ''}
                    </span>
                    <button className="linklike" onClick={() => playSavedSlideshow(s)}>▶️ Play</button>
                    <button
                      className="linklike"
                      onClick={() => { setShareSlideshowId(shareSlideshowId === s.id ? null : s.id); setShareSlideshowSentId(null); }}
                    >
                      📤 Share
                    </button>
                    <button className="linklike" onClick={() => deleteSavedSlideshow(s)}>Delete</button>
                    {shareSlideshowId === s.id && (
                      <div className="share-folder-form">
                        <select value={shareSlideshowTarget} onChange={(e) => setShareSlideshowTarget(e.target.value)}>
                          <option value="">Send to…</option>
                          {directory.map((d) => (
                            <option key={d.email} value={`dm:${d.email}`}>{d.name}</option>
                          ))}
                          {groups.map((g) => (
                            <option key={g.id} value={`group:${g.id}`}>{g.name} (group)</option>
                          ))}
                        </select>
                        <button
                          className="btn-upload"
                          disabled={!shareSlideshowTarget}
                          onClick={async () => {
                            await shareSavedSlideshowInMessages(s, shareSlideshowTarget);
                            setShareSlideshowSentId(s.id);
                            setShareSlideshowId(null);
                            setShareSlideshowTarget('');
                          }}
                        >
                          Send
                        </button>
                      </div>
                    )}
                    {shareSlideshowSentId === s.id && <div className="photo-desc">Sent!</div>}
                  </div>
                ))}
              </div>
            </>
          )}

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
                : 'My uploads'}
            </span>
            <div style={{ display: 'flex', gap: '10px' }}>
              {activeFolderId && folderPhotoIds.length > 0 && (
                <button className="linklike" onClick={() => { setShowShareFolderForm((v) => !v); setShareFolderSent(false); }}>
                  📤 Share this folder
                </button>
              )}
              {(() => {
                const currentList = activeFolderId
                  ? photos.filter((p) => folderPhotoIds.includes(p.id))
                  : photos.filter((p) => p.uploader_email === session.user.email);
                return currentList.length > 0 ? (
                  <button className="linklike" onClick={() => startSlideshow(currentList)}>▶️ Play slideshow</button>
                ) : null;
              })()}
            </div>
          </div>

          {activeFolderId && showShareFolderForm && (
            <div className="share-folder-form">
              <select value={shareFolderTarget} onChange={(e) => setShareFolderTarget(e.target.value)}>
                <option value="">Send to…</option>
                {directory.map((d) => (
                  <option key={d.email} value={`dm:${d.email}`}>{d.name}</option>
                ))}
                {groups.map((g) => (
                  <option key={g.id} value={`group:${g.id}`}>{g.name} (group)</option>
                ))}
              </select>
              <button
                className="btn-upload"
                disabled={!shareFolderTarget}
                onClick={() => {
                  const folder = folders.find((f) => f.id === activeFolderId);
                  if (folder) shareFolderInMessages(folder.id, folder.name, shareFolderTarget);
                }}
              >
                Send
              </button>
            </div>
          )}
          {shareFolderSent && <div className="photo-desc">Sent! They'll see it in Messages.</div>}
          <div className="myphotos-grid">
            {(activeFolderId
              ? photos.filter((p) => folderPhotoIds.includes(p.id))
              : photos.filter((p) => p.uploader_email === session.user.email)
            ).map((p) => (
              <div
                key={p.id}
                className="myphotos-thumb"
                draggable={!activeFolderId}
                onDragStart={(e) => handlePhotoDragStart(e, p.id)}
                onClick={() => openLightbox(p)}
              >
                {previewUrls[p.id] ? (
                  <img src={previewUrls[p.id]} alt={p.description || 'photo'} />
                ) : (
                  <div className="thumb-placeholder" />
                )}
                {activeFolderId && (
                  <button
                    className="linklike"
                    onClick={(e) => { e.stopPropagation(); removePhotoFromFolder(p.id, activeFolderId); }}
                  >
                    Remove from folder
                  </button>
                )}
              </div>
            ))}
            {activeFolderId && folderPhotoIds.length === 0 && (
              <div className="photo-desc">Nothing in this folder yet — drag a photo onto it above.</div>
            )}
            {!activeFolderId && photos.filter((p) => p.uploader_email === session.user.email).length === 0 && (
              <div className="photo-desc">You haven't uploaded anything yet — use the upload box below to add your first photo or video.</div>
            )}
          </div>
        </div>
      )}

      {isAdmin && showLayoutPanel && (
        <div className="admin-panel">
          <h3>Manage layout <button className="linklike panel-close-btn" onClick={() => setShowLayoutPanel(false)}>Close</button></h3>
          <p className="photo-desc">
            The header and hero always appear at the very top for every guest, and aren't affected by this.
            Below that, choose the order of "Browse the category," "Recent memories," the "Recent posts" feed, and the main photo gallery.
            (Messages and My Photos are separate panels a guest opens from the account menu — they aren't page sections, so they're not part of this order.)
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

      {isAdmin && showManageTutorials && (
        <div className="admin-panel">
          <h3>Tutorial videos <button className="linklike panel-close-btn" onClick={() => setShowManageTutorials(false)}>Close</button></h3>
          <p className="photo-desc">
            Two ways to teach a feature: upload a real screen-recorded video, or build a step-by-step
            "slideshow" out of a few screenshots with captions — often faster and just as clear.
            The "Getting started" one plays automatically the first time someone new signs in.
            The others show up as a small "▶️ How-to" button right next to that feature.
          </p>
          <input
            type="file"
            accept="video/*"
            ref={tutorialFileInputRef}
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file && uploadingTutorialKey) {
                const label = TUTORIAL_KEYS.find((t) => t.key === uploadingTutorialKey)?.label || uploadingTutorialKey;
                uploadTutorialVideo(uploadingTutorialKey, label, file);
              }
              e.target.value = '';
            }}
          />
          <input
            type="file"
            accept="image/*"
            ref={tutorialSlideFileInputRef}
            style={{ display: 'none' }}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file && guidedKey) {
                await addTutorialSlide(guidedKey, file, guidedCaption.trim() || 'Step');
                advanceGuidedSetup();
              } else if (file && addingSlideForKey) {
                await addTutorialSlide(addingSlideForKey, file, newSlideCaption.trim() || 'Step');
                setNewSlideCaption('');
                setAddingSlideForKey(null);
              }
              e.target.value = '';
            }}
          />
          <div className="tutorial-manage-list">
            {TUTORIAL_KEYS.map((t) => (
              <div key={t.key} className="tutorial-manage-block">
                <div className="tutorial-manage-row">
                  <span className="tutorial-manage-label">{t.label}{hasTutorial(t.key) ? ' ✅' : ''}</span>
                  <button
                    className="linklike"
                    disabled={uploadingTutorialKey === t.key}
                    onClick={() => { setUploadingTutorialKey(t.key); tutorialFileInputRef.current?.click(); }}
                  >
                    {uploadingTutorialKey === t.key ? 'Uploading…' : tutorialVideos[t.key] ? 'Replace video' : 'Upload video'}
                  </button>
                  {tutorialVideos[t.key] && (
                    <>
                      <button className="linklike" onClick={() => openTutorial(t.key)}>Preview</button>
                      <button className="linklike" onClick={() => deleteTutorialVideo(t.key)}>Remove video</button>
                    </>
                  )}
                </div>

                {(tutorialSlidesMap[t.key]?.length || 0) > 0 && (
                  <div className="tutorial-slide-list">
                    {tutorialSlidesMap[t.key].map((s, i) => (
                      <div key={s.id} className="tutorial-slide-manage-row">
                        <span>{i + 1}. {s.caption}</span>
                        <button className="linklike" disabled={i === 0} onClick={() => moveTutorialSlide(t.key, s.id, -1)}>Up</button>
                        <button className="linklike" disabled={i === tutorialSlidesMap[t.key].length - 1} onClick={() => moveTutorialSlide(t.key, s.id, 1)}>Down</button>
                        <button className="linklike" onClick={() => deleteTutorialSlide(s.id, s.image_path)}>Remove</button>
                      </div>
                    ))}
                    {!tutorialVideos[t.key] && (
                      <button className="linklike" onClick={() => openTutorial(t.key)}>Preview slideshow</button>
                    )}
                  </div>
                )}

                {addingSlideForKey === t.key ? (
                  <div className="msg-edit-row">
                    <input
                      placeholder="What's happening in this screenshot?"
                      value={newSlideCaption}
                      onChange={(e) => setNewSlideCaption(e.target.value)}
                    />
                    <button className="linklike" onClick={() => tutorialSlideFileInputRef.current?.click()}>Choose image</button>
                    <button className="linklike" onClick={() => setAddingSlideForKey(null)}>Cancel</button>
                  </div>
                ) : guidedKey === t.key ? (
                  <div className="guided-setup-card">
                    <div className="guided-setup-step-label">
                      Step {guidedStepIndex + 1} of {TUTORIAL_SCRIPTS[t.key].length}
                    </div>
                    <p>{TUTORIAL_SCRIPTS[t.key][guidedStepIndex].instruction}</p>
                    <div className="field">
                      <label>Caption for this step</label>
                      <input value={guidedCaption} onChange={(e) => setGuidedCaption(e.target.value)} />
                    </div>
                    <div className="guided-setup-actions">
                      <button className="btn-upload" onClick={() => tutorialSlideFileInputRef.current?.click()}>
                        📷 Upload this screenshot
                      </button>
                      <button className="linklike" onClick={advanceGuidedSetup}>Skip this step</button>
                      <button className="linklike" onClick={cancelGuidedSetup}>Stop guided setup</button>
                    </div>
                  </div>
                ) : (
                  <div className="tutorial-add-row">
                    {TUTORIAL_SCRIPTS[t.key] && (
                      <button className="btn-upload" onClick={() => startGuidedSetup(t.key)}>
                        🧭 Start guided setup
                      </button>
                    )}
                    <button className="linklike" onClick={() => setAddingSlideForKey(t.key)}>
                      + Add a screenshot manually
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isAdmin && showAdminPanel && (
        <div className="admin-panel">
          <h3>Guest list <button className="linklike panel-close-btn" onClick={() => setShowAdminPanel(false)}>Close</button></h3>
          <div className="guest-rows">
            {guestList.map((g) => (
              <div className="guest-row" key={g.email}>
                <span className="guest-name">{g.name}</span>
                <span className="guest-email">{g.no_email ? 'No email on file' : g.email}</span>
                {g.no_email && <span className="disabled-badge">no email</span>}
                {g.is_admin && <span className="admin-badge">admin</span>}
                {g.is_disabled && <span className="disabled-badge">disabled</span>}
                <span className="guest-activity">
                  {g.invited_at && <>Invited {new Date(g.invited_at).toLocaleDateString()}</>}
                  {g.first_login_at ? (
                    <> · Signed up {new Date(g.first_login_at).toLocaleString()}</>
                  ) : (
                    <> · not signed up yet</>
                  )}
                  {g.last_login_at && <> · Last login {new Date(g.last_login_at).toLocaleString()}</>}
                  {' · '}{uploadCounts[g.email] || 0} upload{(uploadCounts[g.email] || 0) === 1 ? '' : 's'}
                </span>
                {g.email !== session.user.email && (
                  <>
                    {g.no_email ? (
                      <button
                        className="toggle-btn"
                        onClick={() => generateGuestLink(g.email)}
                        disabled={guestLinkStatusByEmail[g.email] === 'generating'}
                      >
                        {guestLinkStatusByEmail[g.email] === 'generating' ? 'Generating…' : 'Generate sign-in link'}
                      </button>
                    ) : (
                      <button
                        className="toggle-btn"
                        onClick={() => inviteGuest(g.email, g.name)}
                        disabled={inviteStatusByEmail[g.email] === 'sending'}
                      >
                        {inviteStatusByEmail[g.email] === 'sending'
                          ? 'Sending…'
                          : inviteStatusByEmail[g.email] === 'sent'
                          ? 'Sent!'
                          : 'Resend invite'}
                      </button>
                    )}
                    <button className="toggle-btn" onClick={() => toggleGuestAdmin(g.email, g.is_admin)}>
                      {g.is_admin ? 'Remove admin' : 'Make admin'}
                    </button>
                    <button className="toggle-btn" onClick={() => toggleGuestDisabled(g.email, g.is_disabled)}>
                      {g.is_disabled ? 'Enable' : 'Disable'}
                    </button>
                    <button className="remove-btn" onClick={() => removeGuest(g.email)}>Remove</button>
                  </>
                )}
                {g.no_email && guestLinkByEmail[g.email] && (
                  <div className="guest-link-row">
                    <input readOnly value={guestLinkByEmail[g.email]} onFocus={(e) => e.currentTarget.select()} />
                    <button className="toggle-btn" onClick={() => copyGuestLink(g.email)}>
                      {guestLinkStatusByEmail[g.email] === 'copied' ? 'Copied!' : 'Copy link'}
                    </button>
                  </div>
                )}
                {g.no_email && guestLinkErrorByEmail[g.email] && (
                  <div className="gate-error">{guestLinkErrorByEmail[g.email]}</div>
                )}
              </div>
            ))}
          </div>
          <form className="add-guest-form" onSubmit={addGuest}>
            <input placeholder="Name" value={newGuestName} onChange={(e) => setNewGuestName(e.target.value)} />
            {!newGuestNoEmail && (
              <input placeholder="Email" type="email" value={newGuestEmail} onChange={(e) => setNewGuestEmail(e.target.value)} />
            )}
            <label className="guest-no-email-toggle">
              <input
                type="checkbox"
                checked={newGuestNoEmail}
                onChange={(e) => setNewGuestNoEmail(e.target.checked)}
              />
              No email — I'll share a sign-in link instead
            </label>
            <button className="btn-upload" type="submit">Add to guest list</button>
          </form>
          {guestError && <div className="gate-error">{guestError}</div>}
          {newGuestNoEmail && (
            <p className="photo-desc">
              After adding them, click "Generate sign-in link" next to their name, then share the link by text or open it directly on their device.
              It's a one-time link — if it expires before they use it, just generate a new one.
            </p>
          )}
        </div>
      )}

      {isAdmin && showCategoryPanel && (
        <div className="admin-panel">
          <h3>Categories <button className="linklike panel-close-btn" onClick={() => setShowCategoryPanel(false)}>Close</button></h3>
          <div className="photo-desc">Drag isn't available yet — use the arrows to set the order photos will follow when "By category order" is selected in the gallery.</div>
          <div className="guest-rows">
            {categories.map((c, i) => (
              <div className="guest-row" key={c.id}>
                <span className="guest-name">{c.name}</span>
                <button className="toggle-btn" disabled={i === 0} onClick={() => moveCategory(c.id, 'up')}>↑</button>
                <button className="toggle-btn" disabled={i === categories.length - 1} onClick={() => moveCategory(c.id, 'down')}>↓</button>
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

      {isAdmin && showReorderPanel && (
        <div className="admin-panel reorder-panel">
          <h3>Reorder photos <button className="linklike panel-close-btn" onClick={() => setShowReorderPanel(false)}>Close</button></h3>
          <div className="photo-desc">
            Set one master order for every photo. This order is used by the gallery's "By category order" sort and by slideshows.
          </div>
          <div className="reorder-mode-toggle">
            <button
              className={'nav-pill' + (reorderMode === 'list' ? ' active' : '')}
              onClick={() => { setReorderMode('list'); resetClickOrder(); }}
            >
              ↕ Drag or arrows
            </button>
            <button
              className={'nav-pill' + (reorderMode === 'click' ? ' active' : '')}
              onClick={() => setReorderMode('click')}
            >
              🔢 Click to number
            </button>
          </div>

          {reorderMode === 'list' ? (
            <div className="guest-rows">
              {photoOrderList.map((p, i) => (
                <div
                  className={'guest-row reorder-row' + (dragPhotoId === p.id ? ' dragging' : '')}
                  key={p.id}
                  draggable
                  onDragStart={() => setDragPhotoId(p.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => dropPhotoOnto(p.id)}
                  onDragEnd={() => setDragPhotoId(null)}
                >
                  <span className="drag-handle">⠿</span>
                  {previewUrls[p.id] && <img className="reorder-thumb" src={previewUrls[p.id]} alt="" />}
                  <span className="guest-name">{p.uploader_name}</span>
                  <span className="guest-email">{p.description || p.category || ''}</span>
                  <button className="toggle-btn" disabled={i === 0} onClick={() => movePhotoOrder(p.id, 'up')}>↑</button>
                  <button className="toggle-btn" disabled={i === photoOrderList.length - 1} onClick={() => movePhotoOrder(p.id, 'down')}>↓</button>
                </div>
              ))}
              {photoOrderList.length === 0 && <div className="photo-desc">No photos yet.</div>}
            </div>
          ) : (
            <>
              <div className="photo-desc">
                Tap photos in the order you want them to come first. Tap a numbered photo again to un-tap it. Anything you don't tap keeps its current place, after the ones you numbered.
              </div>
              <div className="reorder-click-grid">
                {photoOrderList.map((p) => {
                  const num = clickedOrder.indexOf(p.id) + 1;
                  const isClicked = num > 0;
                  return (
                    <div
                      key={p.id}
                      className={'reorder-click-thumb' + (isClicked ? ' clicked' : '')}
                      onClick={() => handleClickNumber(p.id)}
                    >
                      {previewUrls[p.id] && <img src={previewUrls[p.id]} alt="" />}
                      {isClicked && <span className="reorder-click-badge">{num}</span>}
                    </div>
                  );
                })}
                {photoOrderList.length === 0 && <div className="photo-desc">No photos yet.</div>}
              </div>
              <div className="reorder-click-actions">
                <button className="toggle-btn" onClick={resetClickOrder} disabled={clickedOrder.length === 0}>Reset numbers</button>
                <button className="btn-upload" onClick={saveClickOrder} disabled={clickedOrder.length === 0}>Save order</button>
              </div>
            </>
          )}
        </div>
      )}

      {isAdmin && showRequestsPanel && (
        <div className="admin-panel">
          <h3>Access requests <button className="linklike panel-close-btn" onClick={() => setShowRequestsPanel(false)}>Close</button></h3>
          <div className="guest-rows">
            {pendingRequests.map((r) => (
              <div className="guest-row" key={r.id}>
                <span className="guest-name">
                  {r.first_name} {r.last_name}
                  {r.requested_by && <span className="guest-email"> · invited by {r.requested_by}</span>}
                </span>
                <span className="guest-email">{r.email}</span>
                <button className="toggle-btn" onClick={() => approveRequest(r)}>Approve</button>
                <button className="remove-btn" onClick={() => denyRequest(r)}>Deny</button>
              </div>
            ))}
            {pendingRequests.length === 0 && <div className="photo-desc">No pending requests.</div>}
          </div>
        </div>
      )}

      {isAdmin && showTakedownPanel && (
        <div className="admin-panel">
          <h3>Takedown requests <button className="linklike panel-close-btn" onClick={() => setShowTakedownPanel(false)}>Close</button></h3>
          <p className="photo-desc">Guests can flag a photo they'd like removed. Nothing is deleted until you approve it here.</p>
          <div className="guest-rows takedown-list">
            {takedownRequests.map((r) => {
              const photo = photos.find((p) => p.id === r.photo_id);
              return (
                <div className="takedown-request-row" key={r.id}>
                  {photo && previewUrls[photo.id] && (
                    <img className="takedown-thumb" src={previewUrls[photo.id]} alt="" />
                  )}
                  <div className="takedown-info">
                    <div><strong>Requested by:</strong> {nameFor(r.requested_by_email)}</div>
                    {photo && <div><strong>Uploaded by:</strong> {photo.uploader_name}</div>}
                    {r.reason && <div><strong>Reason:</strong> {r.reason}</div>}
                  </div>
                  <div className="takedown-actions">
                    <button className="remove-btn" onClick={() => approveTakedown(r)}>Delete photo</button>
                    <button className="toggle-btn" onClick={() => dismissTakedown(r)}>Dismiss</button>
                  </div>
                </div>
              );
            })}
            {takedownRequests.length === 0 && <div className="photo-desc">No pending takedown requests.</div>}
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
          <div
            className={`upload-hero${isDragOver ? ' dragover' : ''}`}
            onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragOver(false);
              setShowUploadPanel(true);
              const files = Array.from(e.dataTransfer.files || []).filter(isAcceptedMediaFile);
              handleFiles(files);
            }}
          >
            <div className="upload-hero-icon">📸</div>
            <h2>Add Your Photos &amp; Videos</h2>
            <p>Got pictures or clips from the big day? Drag them here, or tap below to choose files.</p>
            <button className="btn-upload upload-hero-btn" onClick={() => setShowUploadPanel(true)}>
              📤 Upload Photos &amp; Videos
            </button>
          </div>

          {showcasePhotos.length > 0 && (
            <div className="showcase-feed" style={{ order: sectionOrder.indexOf('showcase') }}>
              <h3 className="showcase-title">📰 Recent posts</h3>
              {showcasePhotos.map((p) => (
                <div className="showcase-card" key={p.id}>
                  <div className="showcase-header">
                    <span className="showcase-posted-by">📸 Posted by {p.uploader_name}</span>
                    <span className="showcase-date">{new Date(p.created_at).toLocaleString()}</span>
                  </div>
                  <div className="showcase-media" onClick={() => openLightbox(p)}>
                    {previewUrls[p.id] ? (
                      <img src={previewUrls[p.id]} alt={p.description || 'wedding photo'} />
                    ) : (
                      <div className="thumb-placeholder" />
                    )}
                    {p.media_type === 'video' && <div className="play-badge">▶</div>}
                  </div>
                  {p.description && <div className="showcase-caption">{p.description}</div>}
                  <div className="reaction-bar">
                    {REACTION_EMOJIS.map((emoji) => {
                      const count = reactionsByPhoto[p.id]?.counts[emoji] || 0;
                      if (count === 0) return null;
                      return (
                        <button
                          key={emoji}
                          className={'reaction-pill' + (reactionsByPhoto[p.id]?.mine === emoji ? ' mine' : '')}
                          onClick={() => toggleReaction(p.id, emoji)}
                        >
                          {emoji} {count}
                        </button>
                      );
                    })}
                    <button
                      className="reaction-add-btn"
                      onClick={() => setOpenReactionPickerId(openReactionPickerId === p.id ? null : p.id)}
                    >
                      {reactionsByPhoto[p.id]?.mine ? '···' : '+ React'}
                    </button>
                    {openReactionPickerId === p.id && (
                      <div className="reaction-picker">
                        {REACTION_EMOJIS.map((emoji) => (
                          <button key={emoji} onClick={() => toggleReaction(p.id, emoji)}>{emoji}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <button className="linklike" onClick={() => toggleShowcaseComments(p.id)}>
                    💬 {activeShowcaseCommentId === p.id ? 'Hide comments' : 'Comment'}
                  </button>
                  {activeShowcaseCommentId === p.id && (
                    <div className="showcase-comments">
                      {showcaseComments.map((c) => (
                        <div key={c.id} className="comment-item">
                          <span className="comment-sender">{nameFor(c.sender_email)}:</span> {c.body}
                        </div>
                      ))}
                      {showcaseComments.length === 0 && <div className="photo-desc">No comments yet.</div>}
                      <form
                        className="comment-form"
                        onSubmit={(e) => { e.preventDefault(); sendShowcaseComment(p.id); }}
                      >
                        <input
                          placeholder="Add a comment…"
                          value={newShowcaseComment}
                          onChange={(e) => setNewShowcaseComment(e.target.value)}
                        />
                        <button className="btn-upload" type="submit">Post</button>
                      </form>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          <button
            className={'upload-fab' + (uploadingFiles.length > 0 ? ' uploading' : '')}
            onClick={() => setShowUploadPanel((v) => !v)}
          >
            {showUploadPanel ? '✕' : uploadingFiles.length > 0 ? '⏳' : '📤'}
          </button>

          {showUploadPanel && (
            <div
              className={`upload-fab-panel${isDragOver ? ' dragover' : ''}`}
              onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); setIsDragOver(false); }}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                const files = Array.from(e.dataTransfer.files || []).filter(isAcceptedMediaFile);
                handleFiles(files);
              }}
            >
              <div className="upload-fab-panel-header">
                <strong>Add photos or videos</strong>
                {hasTutorial('uploading') && (
                  <button className="linklike" onClick={() => openTutorial('uploading')}>▶️ How-to</button>
                )}
                <button className="linklike" onClick={() => setShowUploadPanel(false)}>Close</button>
              </div>
              <div className={`upload-box${isDragOver ? ' dragover' : ''}`}>
                <p>Drag photos or videos here, or choose files below</p>
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

              {pendingUploads.length > 0 && (
                <div className="pending-uploads">
                  <div className="photo-desc">Add a description and category for each one, then upload.</div>
                  {pendingUploads.map((item) => {
                    const uploadError = uploadErrors.find((e) => e.id === item.id);
                    return (
                      <div className={'pending-upload-row' + (uploadError ? ' upload-failed' : '')} key={item.id}>
                        <div className="pending-upload-thumb-wrap">
                          {isVideoFile(item.file) ? (
                            <video className="pending-upload-thumb" src={item.previewUrl} muted preload="metadata" />
                          ) : (
                            <img className="pending-upload-thumb" src={item.previewUrl} alt="" />
                          )}
                          {isVideoFile(item.file) && <div className="play-badge pending-upload-play-badge">▶</div>}
                        </div>
                        <div className="pending-upload-fields">
                          <input
                            className="desc-input"
                            placeholder="Description (optional)"
                            value={item.description}
                            onChange={(e) => updatePendingUpload(item.id, { description: e.target.value })}
                          />
                          {categories.length > 0 && (
                            <select
                              className="desc-input"
                              value={item.category}
                              onChange={(e) => updatePendingUpload(item.id, { category: e.target.value })}
                            >
                              <option value="">No category</option>
                              {categories.map((c) => (
                                <option key={c.id} value={c.name}>{c.name}</option>
                              ))}
                            </select>
                          )}
                          {uploadError && <div className="gate-error upload-error-msg">{uploadError.message}</div>}
                        </div>
                        <button className="remove-btn" onClick={() => removePendingUpload(item.id)}>✕</button>
                      </div>
                    );
                  })}
                  <button className="btn-upload" onClick={uploadPendingFiles} disabled={uploadingFiles.length > 0}>
                    Upload {pendingUploads.length} item{pendingUploads.length === 1 ? '' : 's'}
                  </button>
                </div>
              )}

              {uploadingFiles.length > 0 && (
                <>
                  <div className="upload-status">Uploading {uploadingFiles.join(', ')}…</div>
                  <div className="upload-status-hint">
                    Keep this tab open and your phone unlocked until it finishes — switching apps or locking your
                    screen can pause a large video mid-upload.
                  </div>
                </>
              )}
            </div>
          )}

          <div ref={galleryRef} className="filters" style={{ order: sectionOrder.indexOf('gallery') }}>
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
            <select value={mediaTypeFilter} onChange={(e) => setMediaTypeFilter(e.target.value as any)}>
              <option value="all">Photos &amp; videos</option>
              <option value="photo">📷 Photos only</option>
              <option value="video">🎥 Videos only</option>
            </select>
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
              <option value="category">By category order</option>
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
          {selectMode && <div className="select-bar-spacer" />}

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
                {(() => {
                  let lastCategoryHeading: string | null | undefined = undefined;
                  return filteredPhotos.map((p) => {
                    const showHeading = sortOrder === 'category' && p.category !== lastCategoryHeading;
                    if (showHeading) lastCategoryHeading = p.category;
                    return (
                      <Fragment key={p.id}>
                        {showHeading && (
                          <div className="category-heading">📁 {p.category || 'Uncategorized'}</div>
                        )}
                  <div className={'photo-card' + (selectMode && selectedPhotoIds.includes(p.id) ? ' selected' : '')}>
                    <div
                      className={'photo-frame' + (p.media_type === 'video' ? ' video-frame' : '')}
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
                        <div className="reaction-bar">
                          {REACTION_EMOJIS.map((emoji) => {
                            const count = reactionsByPhoto[p.id]?.counts[emoji] || 0;
                            if (count === 0) return null;
                            return (
                              <button
                                key={emoji}
                                className={'reaction-pill' + (reactionsByPhoto[p.id]?.mine === emoji ? ' mine' : '')}
                                onClick={() => toggleReaction(p.id, emoji)}
                              >
                                {emoji} {count}
                              </button>
                            );
                          })}
                          <button
                            className="reaction-add-btn"
                            onClick={() => setOpenReactionPickerId(openReactionPickerId === p.id ? null : p.id)}
                          >
                            {reactionsByPhoto[p.id]?.mine ? '···' : '+ React'}
                          </button>
                          {openReactionPickerId === p.id && (
                            <div className="reaction-picker">
                              {REACTION_EMOJIS.map((emoji) => (
                                <button key={emoji} onClick={() => toggleReaction(p.id, emoji)}>{emoji}</button>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="download-row">
                          <button onClick={() => downloadOriginal(p)}>High-res</button>
                          {p.preview_path && <button onClick={() => downloadPreview(p)}>Web-size</button>}
                          <button
                            onClick={() => {
                              setSharingPhotoId(sharingPhotoId === p.id ? null : p.id);
                              setSharePhotoSentId(null);
                            }}
                          >
                            Share
                          </button>
                        </div>
                        {sharingPhotoId === p.id && (
                          <div className="share-photo-menu">
                            <div className="share-folder-form">
                              <select value={sharePhotoTarget} onChange={(e) => setSharePhotoTarget(e.target.value)}>
                                <option value="">Send to…</option>
                                {directory.map((d) => (
                                  <option key={d.email} value={`dm:${d.email}`}>{d.name}</option>
                                ))}
                                {groups.map((g) => (
                                  <option key={g.id} value={`group:${g.id}`}>{g.name} (group)</option>
                                ))}
                              </select>
                              <button
                                className="btn-upload"
                                disabled={!sharePhotoTarget}
                                onClick={() => sharePhotoInMessages(p.id, sharePhotoTarget)}
                              >
                                Send
                              </button>
                            </div>
                            {sharePhotoSentId === p.id && <div className="photo-desc">Sent! They'll see it in Messages.</div>}
                            {sharePhotoError[p.id] && <div className="gate-error">{sharePhotoError[p.id]}</div>}
                            <button
                              className="linklike"
                              disabled={outsideShareBusyId === p.id}
                              onClick={() => createOutsideShareLink(p)}
                            >
                              {outsideShareBusyId === p.id ? 'Creating link…' : '🔗 Get outside link'}
                            </button>
                            {outsideShareUrl[p.id] && (
                              <div className="outside-share-url">
                                <input readOnly value={outsideShareUrl[p.id]} onClick={(e) => (e.target as HTMLInputElement).select()} />
                                <div className="photo-desc">Copied! Anyone with this link can view just this photo — no sign-in needed.</div>
                              </div>
                            )}
                            {outsideShareError[p.id] && <div className="gate-error">{outsideShareError[p.id]}</div>}
                          </div>
                        )}
                        {canEditOrDelete(p) && (
                          <div className="download-row">
                            <button onClick={() => startEdit(p)}>Edit</button>
                            <button className="delete-photo-btn" onClick={() => deletePhoto(p)}>Delete</button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                      </Fragment>
                    );
                  });
                })()}
              </div>
            )}
          </div>
        </>
      )}

      {lightbox && (
        <div className="lightbox" onClick={() => { setLightbox(null); setLightboxUrl(''); }}>
          <button
            className="lightbox-arrow lightbox-arrow-left"
            onClick={(e) => { e.stopPropagation(); lightboxStep(-1); }}
            aria-label="Previous photo"
          >
            ◀
          </button>
          <button
            className="lightbox-arrow lightbox-arrow-right"
            onClick={(e) => { e.stopPropagation(); lightboxStep(1); }}
            aria-label="Next photo"
          >
            ▶
          </button>
          <div className="lightbox-inner" onClick={(e) => e.stopPropagation()}>
            {lightboxUrl ? (
              lightbox.media_type === 'video' ? (
                <video
                  src={lightboxUrl}
                  controls
                  poster={previewUrls[lightbox.id]}
                  style={{ maxWidth: '100%', maxHeight: '78vh' }}
                />
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
            <div className="reaction-bar centered">
              {REACTION_EMOJIS.map((emoji) => {
                const count = reactionsByPhoto[lightbox.id]?.counts[emoji] || 0;
                return (
                  <button
                    key={emoji}
                    className={'reaction-pill' + (reactionsByPhoto[lightbox.id]?.mine === emoji ? ' mine' : '')}
                    onClick={() => toggleReaction(lightbox.id, emoji)}
                  >
                    {emoji} {count > 0 ? count : ''}
                  </button>
                );
              })}
            </div>
            <div className="lightbox-actions">
              <button onClick={() => lightboxStep(-1)}>◀ Back</button>
              <button onClick={() => lightboxStep(1)}>Next ▶</button>
              <button onClick={() => downloadOriginal(lightbox)}>Download high-res</button>
              {lightbox.preview_path && <button onClick={() => downloadPreview(lightbox)}>Download web-size</button>}
              <button
                onClick={() => {
                  setSharingPhotoId(sharingPhotoId === lightbox.id ? null : lightbox.id);
                  setSharePhotoSentId(null);
                }}
              >
                Share
              </button>
              {canEditOrDelete(lightbox) && <button className="delete-photo-btn" onClick={() => deletePhoto(lightbox)}>Delete</button>}
              <button className="close-btn" onClick={() => { setLightbox(null); setLightboxUrl(''); }}>Close</button>
            </div>
            {sharingPhotoId === lightbox.id && (
              <div className="share-photo-menu">
                <div className="share-folder-form">
                  <select value={sharePhotoTarget} onChange={(e) => setSharePhotoTarget(e.target.value)}>
                    <option value="">Send to…</option>
                    {directory.map((d) => (
                      <option key={d.email} value={`dm:${d.email}`}>{d.name}</option>
                    ))}
                    {groups.map((g) => (
                      <option key={g.id} value={`group:${g.id}`}>{g.name} (group)</option>
                    ))}
                  </select>
                  <button
                    className="btn-upload"
                    disabled={!sharePhotoTarget}
                    onClick={() => sharePhotoInMessages(lightbox.id, sharePhotoTarget)}
                  >
                    Send
                  </button>
                </div>
                {sharePhotoSentId === lightbox.id && <div className="photo-desc">Sent! They'll see it in Messages.</div>}
                {sharePhotoError[lightbox.id] && <div className="gate-error">{sharePhotoError[lightbox.id]}</div>}
                <button
                  className="linklike"
                  disabled={outsideShareBusyId === lightbox.id}
                  onClick={() => createOutsideShareLink(lightbox)}
                >
                  {outsideShareBusyId === lightbox.id ? 'Creating link…' : '🔗 Get outside link'}
                </button>
                {outsideShareUrl[lightbox.id] && (
                  <div className="outside-share-url">
                    <input readOnly value={outsideShareUrl[lightbox.id]} onClick={(e) => (e.target as HTMLInputElement).select()} />
                    <div className="photo-desc">Copied! Anyone with this link can view just this photo — no sign-in needed.</div>
                  </div>
                )}
                {outsideShareError[lightbox.id] && <div className="gate-error">{outsideShareError[lightbox.id]}</div>}
              </div>
            )}

            {!canEditOrDelete(lightbox) && (
              <div className="takedown-row">
                {takedownSent ? (
                  <div className="photo-desc">Request sent — an admin will take a look.</div>
                ) : showTakedownForm ? (
                  <div className="msg-edit-row">
                    <input
                      placeholder="Optional: why should this come down?"
                      value={takedownReason}
                      onChange={(e) => setTakedownReason(e.target.value)}
                    />
                    <button className="linklike" onClick={() => submitTakedownRequest(lightbox)}>Send request</button>
                    <button className="linklike" onClick={() => setShowTakedownForm(false)}>Cancel</button>
                  </div>
                ) : (
                  <button className="linklike" onClick={() => setShowTakedownForm(true)}>
                    🚩 Request this be taken down
                  </button>
                )}
              </div>
            )}

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
                  muted={!!slideshowMusicUrl && !slideshowUseVideoSound}
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

          <div className="slideshow-music-bar">
            {hasTutorial('slideshows') && (
              <button className="linklike" onClick={() => openTutorial('slideshows')}>▶️ How-to</button>
            )}
            <input
              type="file"
              accept="audio/*"
              ref={slideshowMusicInputRef}
              onChange={handleSlideshowMusicChange}
              style={{ display: 'none' }}
            />
            {slideshowMusicUrl ? (
              <>
                <span>🎵 {slideshowMusicName}</span>
                <button className="linklike" onClick={removeSlideshowMusic}>Remove music</button>
                <label className="slideshow-video-sound-toggle">
                  <input
                    type="checkbox"
                    checked={slideshowUseVideoSound}
                    onChange={(e) => setSlideshowUseVideoSound(e.target.checked)}
                  />
                  Use each video's own sound (instead of the music)
                </label>
              </>
            ) : (
              <button className="linklike" onClick={() => slideshowMusicInputRef.current?.click()}>
                🎵 Add background music
              </button>
            )}
            {!showSaveSlideshowForm ? (
              <button className="linklike" onClick={() => setShowSaveSlideshowForm(true)}>
                💾 Save this slideshow
              </button>
            ) : (
              <span className="save-slideshow-inline">
                <input
                  placeholder="Name this slideshow"
                  value={saveSlideshowName}
                  onChange={(e) => setSaveSlideshowName(e.target.value)}
                />
                <button className="linklike" disabled={!saveSlideshowName.trim() || savingSlideshow} onClick={saveCurrentSlideshow}>
                  {savingSlideshow ? 'Saving…' : 'Save'}
                </button>
                <button className="linklike" onClick={() => setShowSaveSlideshowForm(false)}>Cancel</button>
              </span>
            )}
          </div>

          {slideshowMusicUrl && (
            <audio
              ref={slideshowMusicRef}
              src={slideshowMusicUrl}
              loop
              onLoadedMetadata={(e) => setSlideshowMusicDuration(e.currentTarget.duration)}
              style={{ display: 'none' }}
            />
          )}
        </div>
      )}

      {(activeTutorialKey || activeTutorialSlides) && (
        <div className="tutorial-overlay" onClick={closeTutorial}>
          <div className="tutorial-modal" onClick={(e) => e.stopPropagation()}>
            <div className="tutorial-modal-header">
              <strong>{activeTutorialTitle}</strong>
              <button className="linklike" onClick={closeTutorial}>✕ Close</button>
            </div>
            {activeTutorialKey && (
              activeTutorialUrl ? (
                <video src={activeTutorialUrl} controls autoPlay style={{ width: '100%', maxHeight: '70vh' }} />
              ) : (
                <div className="empty-state">Loading…</div>
              )
            )}
            {activeTutorialSlides && (
              <>
                <div className="tutorial-slide-stage">
                  {activeTutorialSlideUrl ? (
                    <img src={activeTutorialSlideUrl} alt="" />
                  ) : (
                    <div className="empty-state">Loading…</div>
                  )}
                </div>
                <div className="tutorial-slide-caption">
                  {activeTutorialSlides[activeTutorialSlideIndex]?.caption}
                </div>
                <div className="tutorial-slide-controls">
                  <button
                    onClick={() => setActiveTutorialSlideIndex((i) => Math.max(0, i - 1))}
                    disabled={activeTutorialSlideIndex === 0}
                  >
                    ⏮ Prev
                  </button>
                  <button onClick={() => setActiveTutorialSlidePlaying((v) => !v)}>
                    {activeTutorialSlidePlaying ? '⏸ Pause' : '▶️ Play'}
                  </button>
                  <button
                    onClick={() => setActiveTutorialSlideIndex((i) => Math.min(activeTutorialSlides.length - 1, i + 1))}
                    disabled={activeTutorialSlideIndex === activeTutorialSlides.length - 1}
                  >
                    Next ⏭
                  </button>
                  <span className="slideshow-counter">
                    {activeTutorialSlideIndex + 1} / {activeTutorialSlides.length}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
