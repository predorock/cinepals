/* Stremio Friends — frontend SPA (vanilla JS) */
(() => {
  "use strict";

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, opts = {}, children = []) {
    const node = document.createElement(tag);
    if (opts.class) node.className = opts.class;
    if (opts.text != null) node.textContent = opts.text;
    if (opts.html != null) node.innerHTML = opts.html;
    if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
    if (opts.on) for (const [evt, fn] of Object.entries(opts.on)) node.addEventListener(evt, fn);
    for (const c of [].concat(children)) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  const escapeHtml = (s) =>
    String(s ?? "").replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );

  // ---------------------------------------------------------------------------
  // API layer
  // ---------------------------------------------------------------------------
  async function api(path, { method = "GET", body } = {}) {
    const opts = {
      method,
      credentials: "same-origin",
      headers: {},
    };
    if (body !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(path, opts);
    } catch (err) {
      throw new ApiError("Network error. Check your connection.", 0);
    }
    let data = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      data = await res.json().catch(() => null);
    }
    if (!res.ok) {
      const msg = (data && (data.error || data.message)) || `Error (${res.status})`;
      throw new ApiError(msg, res.status, data);
    }
    return data;
  }

  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }

  // ---------------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------------
  const toastsEl = $("#toasts");
  function toast(message, type = "info") {
    const icon = type === "success" ? "✅" : type === "error" ? "⚠️" : "ℹ️";
    const node = el("div", { class: `toast ${type}` }, [
      el("span", { text: icon }),
      el("span", { text: message }),
    ]);
    toastsEl.appendChild(node);
    setTimeout(() => {
      node.classList.add("leaving");
      setTimeout(() => node.remove(), 250);
    }, 3600);
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  let currentUser = null;
  let friendsCache = []; // [{ id, email, displayName }]

  const labelFor = (u) => (u && (u.displayName || u.email)) || "User";

  // ---------------------------------------------------------------------------
  // View switching
  // ---------------------------------------------------------------------------
  function showView(name) {
    $("#loading").classList.add("hidden");
    $("#view-guest").classList.toggle("hidden", name !== "guest");
    $("#view-app").classList.toggle("hidden", name !== "app");
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  async function boot() {
    // Show a notice if the magic link was invalid/expired
    const params = new URLSearchParams(location.search);
    if (params.get("error") === "invalid_link") {
      toast("The sign-in link is invalid or has expired. Request a new one.", "error");
      // clear the querystring
      history.replaceState(null, "", location.pathname);
    }

    try {
      const me = await api("/api/auth/me");
      currentUser = me;
      enterApp();
    } catch (err) {
      showView("guest");
      if (err.status !== 401) toast(err.message, "error");
      // Opened from Stremio's "Configure" button at /u/<token>/configure:
      // use the token to show whose addon it is and pre-fill the sign-in email.
      await hintFromAddonToken();
    }
  }

  /** Reads a token from a /u/<token>/configure URL, if present. */
  function tokenFromPath() {
    const m = location.pathname.match(/^\/u\/([^/]+)\/configure\/?$/);
    return m ? m[1] : null;
  }

  /** When not signed in but the URL carries an addon token, pre-fill the login. */
  async function hintFromAddonToken() {
    const token = tokenFromPath();
    if (!token) return;
    try {
      const info = await api(`/api/auth/addon-info/${encodeURIComponent(token)}`);
      const emailInput = $("#login-email");
      if (emailInput && info.email) emailInput.value = info.email;
      const who = info.displayName || info.email;
      toast(`This is ${who}'s addon. Sign in to manage your lists.`, "info");
    } catch {
      /* unknown/invalid token: just show the normal sign-in screen */
    }
  }

  // ---------------------------------------------------------------------------
  // GUEST: login
  // ---------------------------------------------------------------------------
  function initGuest() {
    const form = $("#login-form");
    const submitBtn = $("#login-submit");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = $("#login-email").value.trim();
      if (!email) return;
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending…";
      try {
        await api("/api/auth/request", { method: "POST", body: { email } });
        $("#login-sent").classList.remove("hidden");
        form.classList.add("hidden");
      } catch (err) {
        toast(err.message, "error");
        submitBtn.disabled = false;
        submitBtn.textContent = "Send me the sign-in link";
      }
    });
  }

  // ---------------------------------------------------------------------------
  // APP: enter & header
  // ---------------------------------------------------------------------------
  function enterApp() {
    $("#user-name").textContent = currentUser.displayName || currentUser.email;
    $("#user-email").textContent = currentUser.displayName ? currentUser.email : "";
    renderAddon();
    showView("app");
    refreshFriends();
    refreshSuggestionsReceived();
    refreshSuggestionsSent();
  }

  function renderAddon() {
    $("#manifest-url").value = currentUser.manifestUrl || "";
    $("#install-btn").setAttribute("href", currentUser.installUrl || "#");
    // "Update" reopens the same install deep-link: Stremio re-fetches the
    // manifest, refreshing the per-friend catalogs.
    $("#update-btn").setAttribute("href", currentUser.installUrl || "#");
  }

  /** Nudge to refresh Stremio after the friend list (and thus catalogs) changed. */
  function promptStremioUpdate() {
    toast("Your friend lists changed — click '🔄 Update in Stremio' to refresh.", "info");
  }

  // ---------------------------------------------------------------------------
  // Header actions
  // ---------------------------------------------------------------------------
  function initHeader() {
    $("#logout-btn").addEventListener("click", async () => {
      try {
        await api("/api/auth/logout", { method: "POST" });
      } catch (_) { /* no-op */ }
      currentUser = null;
      location.reload();
    });
  }

  // ---------------------------------------------------------------------------
  // Addon section actions
  // ---------------------------------------------------------------------------
  function initAddon() {
    $("#copy-manifest-btn").addEventListener("click", async () => {
      const url = $("#manifest-url").value;
      try {
        await navigator.clipboard.writeText(url);
        toast("URL copied to clipboard!", "success");
      } catch (_) {
        // fallback
        const input = $("#manifest-url");
        input.removeAttribute("readonly");
        input.select();
        document.execCommand("copy");
        input.setAttribute("readonly", "");
        toast("URL copied!", "success");
      }
    });

    $("#regen-token-btn").addEventListener("click", async () => {
      const ok = confirm(
        "Regenerate the token?\n\nThe old addon URL will stop working and you'll need to reinstall it in Stremio."
      );
      if (!ok) return;
      try {
        const data = await api("/api/auth/me/regenerate-token", { method: "POST" });
        currentUser.addonToken = data.addonToken;
        currentUser.manifestUrl = data.manifestUrl;
        // installUrl is derived from the manifest; rebuild the deep link if needed
        if (data.manifestUrl) {
          currentUser.installUrl =
            "stremio://" + data.manifestUrl.replace(/^https?:\/\//, "");
        }
        renderAddon();
        toast("Token regenerated. Reinstall the addon in Stremio.", "success");
      } catch (err) {
        toast(err.message, "error");
      }
    });

    $("#delete-account-btn").addEventListener("click", async () => {
      const ok = confirm(
        "Permanently delete your account?\n\nThis action is irreversible and removes your friends and suggestions."
      );
      if (!ok) return;
      try {
        await api("/api/auth/me", { method: "DELETE" });
        toast("Account deleted.", "success");
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  // ---------------------------------------------------------------------------
  // FRIENDS
  // ---------------------------------------------------------------------------
  function initFriends() {
    $("#add-friend-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = $("#add-friend-email");
      const email = input.value.trim();
      if (!email) return;
      try {
        const res = await api("/api/friends/request", { method: "POST", body: { email } });
        input.value = "";
        const status = res && res.status;
        if (status === "already_friends") toast("You're already friends!", "info");
        else if (status === "self") toast("You can't add yourself 🙂", "info");
        else if (status === "duplicate" || status === "pending") toast("Request already sent.", "info");
        else if (status === "accepted") { toast("Request accepted: you're now friends!", "success"); promptStremioUpdate(); }
        else toast("Friend request sent!", "success");
        refreshFriends();
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  async function refreshFriends() {
    try {
      const [friendsData, reqData] = await Promise.all([
        api("/api/friends"),
        api("/api/friends/requests"),
      ]);
      friendsCache = (friendsData && friendsData.friends) || [];
      renderFriends(friendsCache);
      renderIncoming((reqData && reqData.incoming) || []);
      renderOutgoing((reqData && reqData.outgoing) || []);
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function renderFriends(friends) {
    const list = $("#friends-list");
    list.innerHTML = "";
    if (!friends.length) {
      list.appendChild(el("li", { class: "empty", text: "No friends yet. Add one by email!" }));
      return;
    }
    for (const f of friends) {
      const item = el("li", { class: "list-item" }, [
        el("div", { class: "li-main" }, [
          el("div", { class: "li-name", text: labelFor(f) }),
          f.displayName ? el("div", { class: "li-sub", text: f.email }) : null,
        ]),
        el("div", { class: "li-actions" }, [
          el("button", {
            class: "btn-icon no", attrs: { title: "Remove friend" }, text: "✕",
            on: { click: () => removeFriend(f) },
          }),
        ]),
      ]);
      list.appendChild(item);
    }
  }

  async function removeFriend(friend) {
    if (!confirm(`Remove ${labelFor(friend)} from your friends?`)) return;
    try {
      await api(`/api/friends/${encodeURIComponent(friend.id)}`, { method: "DELETE" });
      toast("Friend removed.", "success");
      promptStremioUpdate();
      refreshFriends();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function renderIncoming(incoming) {
    const list = $("#incoming-list");
    list.innerHTML = "";
    if (!incoming.length) {
      list.appendChild(el("li", { class: "empty", text: "No incoming requests." }));
      return;
    }
    for (const r of incoming) {
      const u = r.requester || {};
      const item = el("li", { class: "list-item" }, [
        el("div", { class: "li-main" }, [
          el("div", { class: "li-name", text: labelFor(u) }),
          u.displayName ? el("div", { class: "li-sub", text: u.email }) : null,
        ]),
        el("div", { class: "li-actions" }, [
          el("button", {
            class: "btn-icon ok", attrs: { title: "Accept" }, text: "✓ Accept",
            on: { click: () => respondRequest(r.id, "accept") },
          }),
          el("button", {
            class: "btn-icon no", attrs: { title: "Decline" }, text: "✕",
            on: { click: () => respondRequest(r.id, "decline") },
          }),
        ]),
      ]);
      list.appendChild(item);
    }
  }

  async function respondRequest(friendshipId, action) {
    try {
      await api(`/api/friends/${encodeURIComponent(friendshipId)}/${action}`, { method: "POST" });
      toast(action === "accept" ? "Request accepted!" : "Request declined.", "success");
      if (action === "accept") promptStremioUpdate();
      refreshFriends();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function renderOutgoing(outgoing) {
    const list = $("#outgoing-list");
    list.innerHTML = "";
    if (!outgoing.length) {
      list.appendChild(el("li", { class: "empty", text: "No pending sent requests." }));
      return;
    }
    for (const r of outgoing) {
      const u = r.addressee || {};
      const item = el("li", { class: "list-item" }, [
        el("div", { class: "li-main" }, [
          el("div", { class: "li-name", text: labelFor(u) }),
          u.displayName ? el("div", { class: "li-sub", text: u.email }) : null,
        ]),
        el("span", { class: "badge badge-pending", text: "Pending" }),
      ]);
      list.appendChild(item);
    }
  }

  // ---------------------------------------------------------------------------
  // SEARCH + SUGGEST
  // ---------------------------------------------------------------------------
  function initSearch() {
    $("#search-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = $("#search-query").value.trim();
      const type = $("#search-type").value;
      const grid = $("#search-results");
      if (!q) return;
      grid.innerHTML = `<div class="empty">Searching…</div>`;
      try {
        const data = await api(
          `/api/search?q=${encodeURIComponent(q)}&type=${encodeURIComponent(type)}`
        );
        renderSearchResults((data && data.results) || []);
      } catch (err) {
        grid.innerHTML = "";
        toast(err.message, "error");
      }
    });
  }

  function renderSearchResults(results) {
    const grid = $("#search-results");
    grid.innerHTML = "";
    if (!results.length) {
      grid.appendChild(el("div", { class: "empty", text: "No results. Try another title." }));
      return;
    }
    for (const r of results) {
      const poster = r.poster
        ? el("img", {
            class: "result-poster",
            attrs: { src: r.poster, alt: r.name || r.imdbId, loading: "lazy" },
            on: { error: (e) => { e.target.replaceWith(placeholderPoster()); } },
          })
        : placeholderPoster();

      const card = el("div", { class: "result-card", attrs: { role: "button", tabindex: "0" } }, [
        poster,
        el("div", { class: "result-info" }, [
          el("div", { class: "result-title", text: r.name || r.imdbId }),
          r.year ? el("div", { class: "result-year", text: String(r.year) }) : null,
        ]),
      ]);
      const open = () => openSuggestModal(r);
      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
      grid.appendChild(card);
    }
  }

  function placeholderPoster() {
    return el("div", { class: "result-poster placeholder", text: "🎬" });
  }

  // ---------------------------------------------------------------------------
  // Suggest modal
  // ---------------------------------------------------------------------------
  let suggestTarget = null;

  function openSuggestModal(item) {
    suggestTarget = item;
    $("#suggest-modal-name").textContent = item.name || item.imdbId;
    $("#suggest-modal-year").textContent = item.year ? String(item.year) : "";
    const poster = $("#suggest-modal-poster");
    if (item.poster) {
      poster.src = item.poster;
      poster.style.display = "";
    } else {
      poster.style.display = "none";
    }
    $("#suggest-note").value = "";

    // populate friends dropdown
    const select = $("#suggest-friend");
    select.innerHTML = "";
    if (!friendsCache.length) {
      select.appendChild(el("option", { attrs: { value: "" }, text: "— No friends available —" }));
      $("#suggest-form button[type=submit]").disabled = true;
    } else {
      $("#suggest-form button[type=submit]").disabled = false;
      select.appendChild(el("option", { attrs: { value: "" }, text: "Choose a friend…" }));
      for (const f of friendsCache) {
        select.appendChild(el("option", { attrs: { value: f.id }, text: labelFor(f) }));
      }
    }

    $("#suggest-modal").classList.remove("hidden");
  }

  function closeSuggestModal() {
    $("#suggest-modal").classList.add("hidden");
    suggestTarget = null;
  }

  function initSuggestModal() {
    $("#suggest-modal-close").addEventListener("click", closeSuggestModal);
    $("#suggest-modal").addEventListener("click", (e) => {
      if (e.target.id === "suggest-modal") closeSuggestModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !$("#suggest-modal").classList.contains("hidden")) closeSuggestModal();
    });

    $("#suggest-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!suggestTarget) return;
      const toUserId = $("#suggest-friend").value;
      if (!toUserId) { toast("Choose a friend.", "info"); return; }
      const note = $("#suggest-note").value.trim();
      const body = {
        toUserId,
        imdbId: suggestTarget.imdbId,
        contentType: suggestTarget.type || "movie",
        note,
      };
      try {
        const res = await api("/api/suggestions", { method: "POST", body });
        const status = res && res.status;
        if (status === "created") {
          toast("Suggested! 🎉", "success");
          closeSuggestModal();
          refreshSuggestionsSent();
        } else if (status === "not_friends") {
          toast("You are not friends yet, can't suggest.", "error");
        } else if (status === "duplicate") {
          toast("You've already suggested this title to this person.", "info");
        } else if (status === "self") {
          toast("You can't suggest a title to yourself 🙂", "info");
        } else {
          toast("Suggestion sent.", "success");
          closeSuggestModal();
          refreshSuggestionsSent();
        }
      } catch (err) {
        toast(err.message, "error");
      }
    });
  }

  // ---------------------------------------------------------------------------
  // SUGGESTIONS received / sent
  // ---------------------------------------------------------------------------
  const STATUS_LABELS = {
    created: "New",
    pending: "New",
    seen: "Watched",
    watched: "Watched",
    dismissed: "Dismissed",
  };
  const statusBadge = (status) => {
    const cls = `badge badge-${status || "created"}`;
    return el("span", { class: cls, text: STATUS_LABELS[status] || status || "New" });
  };

  function titleLink(s) {
    // We don't get the title name from the suggestions API: use imdbId + IMDb link.
    const imdbUrl = `https://www.imdb.com/title/${encodeURIComponent(s.imdbId)}/`;
    return el("a", {
      class: "li-name",
      text: s.name || s.imdbId,
      attrs: { href: imdbUrl, target: "_blank", rel: "noopener noreferrer" },
    });
  }

  function suggPoster(s) {
    if (s.poster) {
      return el("img", {
        class: "sugg-poster",
        attrs: { src: s.poster, alt: s.imdbId, loading: "lazy" },
        on: { error: (e) => { e.target.style.visibility = "hidden"; } },
      });
    }
    return el("div", { class: "sugg-poster", attrs: { style: "display:grid;place-items:center" }, text: "🎬" });
  }

  async function refreshSuggestionsReceived() {
    const list = $("#received-list");
    try {
      const data = await api("/api/suggestions/received");
      const items = (data && data.suggestions) || [];
      list.innerHTML = "";
      if (!items.length) {
        list.appendChild(el("li", { class: "empty", text: "No suggestions received." }));
        return;
      }
      for (const s of items) {
        const from = s.fromUser || {};
        const typeLabel = s.contentType === "series" ? "📺 Series" : "🎬 Movie";
        const item = el("li", { class: "list-item" }, [
          el("div", { class: "sugg-top" }, [
            suggPoster(s),
            el("div", { class: "li-main" }, [
              titleLink(s),
              el("div", { class: "li-sub", text: `${typeLabel} · from ${labelFor(from)}` }),
            ]),
            statusBadge(s.status),
          ]),
          s.note ? el("div", { class: "sugg-note", text: `“${s.note}”` }) : null,
          el("div", { class: "sugg-foot" }, [
            el("span", { class: "li-sub", text: formatDate(s.createdAt) }),
            el("div", { class: "li-actions" }, [
              el("button", {
                class: "btn-icon ok", text: "✓ Watched",
                on: { click: () => patchSuggestion(s.id, "watched", refreshSuggestionsReceived) },
              }),
              el("button", {
                class: "btn-icon no", text: "✕ Dismiss",
                on: { click: () => patchSuggestion(s.id, "dismissed", refreshSuggestionsReceived) },
              }),
            ]),
          ]),
        ]);
        list.appendChild(item);
      }
    } catch (err) {
      list.innerHTML = "";
      list.appendChild(el("li", { class: "empty", text: "Couldn't load suggestions." }));
      toast(err.message, "error");
    }
  }

  async function refreshSuggestionsSent() {
    const list = $("#sent-list");
    try {
      const data = await api("/api/suggestions/sent");
      const items = (data && data.suggestions) || [];
      list.innerHTML = "";
      if (!items.length) {
        list.appendChild(el("li", { class: "empty", text: "You haven't sent any suggestions yet." }));
        return;
      }
      for (const s of items) {
        const to = s.toUser || {};
        const typeLabel = s.contentType === "series" ? "📺 Series" : "🎬 Movie";
        const item = el("li", { class: "list-item" }, [
          el("div", { class: "sugg-top" }, [
            suggPoster(s),
            el("div", { class: "li-main" }, [
              titleLink(s),
              el("div", { class: "li-sub", text: `${typeLabel} · to ${labelFor(to)}` }),
            ]),
            statusBadge(s.status),
          ]),
          s.note ? el("div", { class: "sugg-note", text: `“${s.note}”` }) : null,
          el("div", { class: "sugg-foot" }, [
            el("span", { class: "li-sub", text: formatDate(s.createdAt) }),
          ]),
        ]);
        list.appendChild(item);
      }
    } catch (err) {
      list.innerHTML = "";
      list.appendChild(el("li", { class: "empty", text: "Couldn't load suggestions." }));
      toast(err.message, "error");
    }
  }

  async function patchSuggestion(id, status, after) {
    try {
      await api(`/api/suggestions/${encodeURIComponent(id)}`, { method: "PATCH", body: { status } });
      toast(status === "watched" ? "Marked as watched ✓" : "Suggestion dismissed.", "success");
      if (after) after();
    } catch (err) {
      toast(err.message, "error");
    }
  }

  function formatDate(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d)) return "";
    try {
      return d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
    } catch (_) {
      return d.toISOString().slice(0, 10);
    }
  }

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    initGuest();
    initHeader();
    initAddon();
    initFriends();
    initSearch();
    initSuggestModal();
    boot();
  });
})();
