// styles.js — Application styles (exact copy from score-reader.jsx)

export const styles = {
  authBg: {
    minHeight:"100vh", background:"#111", display:"flex", alignItems:"center",
    justifyContent:"center", fontFamily:"'Georgia', serif",
    backgroundImage:"radial-gradient(ellipse at 30% 60%, #1e1608 0%, #111 60%)",
  },
  authCard: {
    background:"#181410", border:"1px solid #2e2416", borderRadius:16,
    padding:"40px 36px", width:"100%", maxWidth:420, display:"flex",
    flexDirection:"column", gap:14, boxShadow:"0 24px 80px rgba(0,0,0,0.6)",
  },
  authLogo: { display:"flex", alignItems:"center", gap:12, marginBottom:4 },
  authBrand: { fontSize:22, fontWeight:700, color:"#C9A84C", letterSpacing:"0.04em" },
  authTitle: { fontSize:18, color:"#e8d9b0", margin:0, fontWeight:400 },
  authInput: {
    background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:8, padding:"10px 14px",
    color:"#e8d9b0", fontSize:14, fontFamily:"inherit", outline:"none",
  },
  authBtn: {
    background:"#C9A84C", color:"#1a1200", border:"none", borderRadius:8,
    padding:"12px 0", fontSize:15, fontWeight:700, cursor:"pointer", letterSpacing:"0.03em",
  },
  authToggle: {
    background:"none", border:"none", color:"#876a2a", fontSize:13, cursor:"pointer", padding:4,
  },
  authError: { color:"#ee5555", fontSize:13, padding:"4px 8px", background:"#2a1111", borderRadius:6 },
  instrNote: { color:"#a89060", fontSize:13, lineHeight:1.6, margin:0 },
  instrGrid: { display:"flex", flexWrap:"wrap", gap:8, marginTop:8 },
  instrBtn: {
    background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:8, padding:"7px 12px",
    color:"#a89060", fontSize:12, cursor:"pointer",
  },
  instrBtnActive: { background:"#C9A84C22", border:"1px solid #C9A84C", color:"#C9A84C" },
  transpBadge: {
    background:"#1e2a1e", border:"1px solid #2a4a2a", borderRadius:8, padding:"8px 12px",
    color:"#6aaa6a", fontSize:12,
  },
  calibHeader: { display:"flex", justifyContent:"space-between", alignItems:"center" },
  calibScaleName: { fontSize:18, color:"#C9A84C", fontWeight:700 },
  calibProgress: { fontSize:13, color:"#666" },
  progressBar: { height:4, background:"#2a2010", borderRadius:2, overflow:"hidden" },
  progressFill: { height:"100%", background:"#C9A84C", transition:"width 0.4s ease", borderRadius:2 },
  scaleDisplay: { display:"flex", gap:6, flexWrap:"wrap", justifyContent:"center", padding:"16px 0" },
  scaleNote: {
    width:44, height:44, display:"flex", alignItems:"center", justifyContent:"center",
    background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:8,
    color:"#888", fontSize:13, fontWeight:700, transition:"all 0.2s",
  },
  scaleNoteHit: { background:"#C9A84C22", border:"1px solid #C9A84C", color:"#C9A84C" },
  freqDisplay: {
    display:"flex", gap:12, alignItems:"center", justifyContent:"center",
    padding:"12px", background:"#1a1610", borderRadius:8, border:"1px solid #2a2010",
  },
  freqHz: { fontSize:22, color:"#e8d9b0", fontFamily:"monospace" },
  freqNote: { fontSize:16, color:"#C9A84C", fontWeight:700 },
  mainBg: { minHeight:"100vh", background:"#0e0c09", display:"flex", flexDirection:"column", fontFamily:"'Georgia', serif" },
  topBar: {
    height:56, background:"#13100d", borderBottom:"1px solid #2a2010",
    display:"flex", alignItems:"center", justifyContent:"space-between",
    padding:"0 20px", flexShrink:0, position:"sticky", top:0, zIndex:100,
  },
  topBrand: { display:"flex", alignItems:"center", gap:10 },
  topBrandName: { fontSize:18, fontWeight:700, color:"#C9A84C", letterSpacing:"0.05em" },
  topControls: { display:"flex", alignItems:"center", gap:12 },
  uploadBtn: {
    background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:8,
    padding:"7px 14px", color:"#a89060", fontSize:13, cursor:"pointer",
  },
  micBtn: {
    background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:8,
    padding:"7px 14px", color:"#a89060", fontSize:13, cursor:"pointer",
  },
  micBtnActive: { background:"#2a0a0a", border:"1px solid #aa3333", color:"#ee6666" },
  topToggle: { display:"flex", alignItems:"center", color:"#887060", fontSize:13, cursor:"pointer" },
  userBadge: {
    display:"flex", alignItems:"center", gap:8, cursor:"pointer", padding:"4px 10px",
    borderRadius:8, border:"1px solid #2a2010", background:"#1a1610",
  },
  avatar: {
    width:28, height:28, borderRadius:"50%", background:"#C9A84C", color:"#1a1200",
    display:"flex", alignItems:"center", justifyContent:"center", fontWeight:700, fontSize:13,
  },
  userName: { color:"#a89060", fontSize:13 },
  profileDrop: {
    position:"absolute", top:58, right:20, background:"#181410", border:"1px solid #2e2416",
    borderRadius:10, padding:16, minWidth:200, zIndex:200,
    boxShadow:"0 16px 48px rgba(0,0,0,0.7)", display:"flex", flexDirection:"column", gap:8,
  },
  profileItem: { color:"#a89060", fontSize:13 },
  profileBtn: {
    background:"#1e1a14", border:"1px solid #3a2e1e", borderRadius:8,
    padding:"7px 12px", color:"#a89060", fontSize:13, cursor:"pointer", textAlign:"left",
  },
  mainBody: { display:"flex", flex:1, overflow:"hidden", height:"calc(100vh - 56px)" },
  scorePanel: {
    flex:1, overflow:"auto", background:"#0e0c09", padding:24,
    scrollBehavior:"smooth",
  },
  scorePlaceholder: {
    display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
    height:"100%", gap:16,
  },
  placeholderIcon: { fontSize:80, color:"#2a2010", lineHeight:1 },
  placeholderText: { fontSize:18, color:"#4a3820" },
  placeholderSub: { fontSize:13, color:"#3a2e18", textAlign:"center", lineHeight:1.7 },
  pdfFrame: { width:"100%", height:"100%", border:"none", borderRadius:4 },
  osmdContainer: { background:"white", borderRadius:8, padding:16, minHeight:400 },
  osmdError: { color:"#ee5555", fontSize:13, marginBottom:8, padding:8, background:"#2a1111", borderRadius:6 },
  rightPanel: {
    width:260, background:"#13100d", borderLeft:"1px solid #2a2010",
    display:"flex", flexDirection:"column", gap:0, overflow:"auto",
  },
  pitchCard: {
    padding:16, borderBottom:"1px solid #1e1810", display:"flex",
    flexDirection:"column", alignItems:"center", gap:4,
  },
  pitchTitle: { fontSize:11, textTransform:"uppercase", letterSpacing:"0.1em", color:"#554030", fontWeight:700 },
  bigNote: { fontSize:44, color:"#C9A84C", fontWeight:700, lineHeight:1 },
  freqLine: { fontSize:12, color:"#666", fontFamily:"monospace" },
  tunerTrack: {
    width:"100%", height:6, background:"#1e1810", borderRadius:3, position:"relative", margin:"6px 0",
  },
  tunerNeedle: {
    position:"absolute", top:-2, width:10, height:10, borderRadius:"50%", transform:"translateX(-50%)",
    transition:"left 0.1s ease, background 0.2s",
  },
  tunerCenter: {
    position:"absolute", top:-3, left:"50%", width:1, height:12, background:"#3a3020", transform:"translateX(-50%)",
  },
  centsLabel: { fontSize:12, fontFamily:"monospace", fontWeight:700 },
  pitchIdle: { color:"#443828", fontSize:13, padding:"12px 0", textAlign:"center" },
  historyCard: { padding:12, borderBottom:"1px solid #1e1810" },
  historyScroll: { display:"flex", flexWrap:"wrap", gap:4, marginTop:6 },
  historyNote: {
    fontSize:11, color:"#C9A84C", background:"#1e1608", border:"1px solid #2e2010",
    borderRadius:4, padding:"2px 6px", fontFamily:"monospace",
  },
  sidebarTabs: { display:"flex", borderBottom:"1px solid #1e1810" },
  sidebarTab: {
    flex:1, padding:"8px 0", background:"none", border:"none", color:"#554030",
    fontSize:12, cursor:"pointer", fontFamily:"inherit",
  },
  sidebarTabActive: { color:"#C9A84C", borderBottom:"2px solid #C9A84C" },
  markingsCard: { padding:12, flex:1 },
  markingItem: {
    display:"flex", flexWrap:"wrap", gap:4, padding:"6px 0",
    borderBottom:"1px solid #1a1610", alignItems:"center",
  },
  markingType: { fontSize:12, color:"#a89060", fontWeight:700 },
  markingCount: { fontSize:11, color:"#C9A84C", background:"#1e1608", borderRadius:4, padding:"1px 5px" },
  markingDetail: { fontSize:11, color:"#665040", flex:"1 1 100%", paddingLeft:2 },
  infoRow: { display:"flex", justifyContent:"space-between", padding:"6px 0", borderBottom:"1px solid #1a1610" },
  infoLabel: { fontSize:12, color:"#665040" },
  infoVal: { fontSize:12, color:"#a89060", textAlign:"right", maxWidth:140 },
  settingRow: { display:"flex", alignItems:"center", padding:"8px 0", borderBottom:"1px solid #1a1610", gap:8 },
  alertBanner: {
    background:"#d4a574", color:"#1a1200", padding:"12px 16px", textAlign:"center",
    fontSize:13, fontWeight:700, position:"relative", zIndex:99,
  },
  errorBanner: {
    background:"#351616", color:"#ffb3b3", padding:"10px 16px", display:"flex",
    alignItems:"center", justifyContent:"space-between", gap:12, fontSize:13, zIndex:99,
  },
  errorDismiss: {
    background:"transparent", border:"1px solid #8b4444", color:"#ffb3b3", borderRadius:6,
    padding:"4px 8px", cursor:"pointer", fontSize:12,
  },
  tempoPrompter: {
    position:"fixed", bottom:20, left:"50%", transform:"translateX(-50%)",
    background:"#181410", border:"2px solid #C9A84C", borderRadius:12, padding:20,
    textAlign:"center", zIndex:300, minWidth:240, boxShadow:"0 16px 48px rgba(0,0,0,0.8)",
  },
  tempoTitle: { fontSize:20, color:"#C9A84C", fontWeight:700, marginBottom:6 },
  tempoSubtitle: { fontSize:14, color:"#a89060", marginBottom:12 },
  tempoBtn: {
    background:"#C9A84C", color:"#1a1200", border:"none", borderRadius:6,
    padding:"8px 16px", fontSize:12, fontWeight:700, cursor:"pointer",
  },
  markingSuggestionsBanner: {
    background:"#2a2418", color:"#d4af9f", padding:"12px 16px", textAlign:"left",
    fontSize:13, position:"relative", zIndex:98, borderBottom:"1px solid #3a2e1e",
  },
  stickyNotesOverlay: {
    position:"absolute", top:0, left:0, right:0, bottom:0, pointerEvents:"none", zIndex:97,
  },
  stickyNote: {
    position:"absolute", width:120, minHeight:60, padding:"8px 10px", borderRadius:6,
    boxShadow:"0 4px 12px rgba(0,0,0,0.3)", cursor:"pointer", pointerEvents:"auto",
    border:"2px solid #C9A84C", transform:"rotate(-2deg)",
  },
  stickyNoteText: { fontSize:11, color:"#1a1200", lineHeight:1.3, wordWrap:"break-word" },
  stickyNoteInput: {
    fontSize:11, color:"#1a1200", lineHeight:1.3, wordWrap:"break-word",
    background:"transparent", border:"none", outline:"none", width:"100%",
  },
  stickyNoteMeasure: { fontSize:9, color:"#665040", marginTop:4, textAlign:"right", fontWeight:700 },
  stickyNoteModeOverlay: {
    position:"absolute", top:0, left:0, right:0, bottom:0,
    background:"rgba(201, 168, 76, 0.1)", cursor:"crosshair", zIndex:96,
    display:"flex", alignItems:"center", justifyContent:"center",
  },
  stickyNoteModeHint: {
    background:"#C9A84C", color:"#1a1200", padding:"8px 16px", borderRadius:6,
    fontSize:12, fontWeight:700, boxShadow:"0 4px 16px rgba(0,0,0,0.4)",
  },
  restAlertBanner: {
    padding:"10px 16px", borderRadius:8, marginBottom:12, border:"1px solid #3a2e18",
  },
};
