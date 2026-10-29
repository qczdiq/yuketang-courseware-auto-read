// ==UserScript==
// @name         雨课堂自动阅读 / 定时翻页
// @namespace    local.auto-page-down
// @version      2.4.0
// @description  雨课堂专用：默认暂停，手动开始后自动进入未完成课件，未读页等待、已读页跳过，首页按“未读”标记消失开始翻页，读完自动校验补读，再返回课程目录继续下一个；面板与胶囊带每秒推进的进度条，可最小化并带过渡动画。
// @match        https://changjiang.yuketang.cn/*
// @run-at       document-end
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(() => {
    'use strict';

    const LIST_ROUTE = /^\/v2\/web\/studentLog\/(\d+)/;
    const CARDS_ROUTE = /^\/v2\/web\/studentCards\/(\d+)\/([^/]+)\/(\d+)/;
    const DEFAULT_INTERVAL = 1.1;
    const QUICK_DELAY = 180;
    const FIRST_PAGE_TIMEOUT = 12000;
    const VERIFY_TIMEOUT = 4000;
    const VERIFY_ROUNDS = 2;
    const LAST_PAGE_HOLD = 2000;
    const PROGRESS_STEP = 1000;

    if (!LIST_ROUTE.test(location.pathname) && !CARDS_ROUTE.test(location.pathname)) {
        return;
    }

    const storedInterval = Number(GM_getValue('intervalV2', DEFAULT_INTERVAL));
    let interval = Number.isFinite(storedInterval) && storedInterval >= 0.1 ? storedInterval : DEFAULT_INTERVAL;
    let running = false;
    let generation = 0;

    const host = document.createElement('div');
    host.id = 'auto-page-down-panel';
    host.style.cssText = 'position:fixed!important;right:20px!important;bottom:20px!important;z-index:2147483647!important;';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
        <style>
            :host { all: initial; color-scheme: light; }
            * { box-sizing: border-box; }
            .panel {
                width: 230px; padding: 16px; border: 1px solid #dce2eb; border-radius: 12px;
                background: #fff; color: #243047; box-shadow: 0 6px 24px #0002;
                font: 14px/1.5 system-ui, sans-serif;
                transform-origin: bottom right;
                transition: opacity .2s ease, transform .34s cubic-bezier(.2, .9, .25, 1), filter .2s ease;
                will-change: transform, opacity;
            }
            .panel.hidden { display: none; }
            .panel.leaving {
                opacity: 0;
                transform: translate(18px, 18px) scale(.55);
                filter: blur(2px);
                pointer-events: none;
            }
            .head {
                display: flex; align-items: center; justify-content: space-between;
                gap: 8px; margin-bottom: 12px;
            }
            .head h2 { margin: 0; font-size: 16px; }
            label { display: block; }
            input {
                width: 100%; height: 34px; margin-top: 4px; padding: 4px 8px;
                border: 1px solid #bcc6d5; border-radius: 6px; background: #fff;
                color: #243047; font: inherit;
            }
            button {
                border: 0; border-radius: 6px; background: #2563eb; color: #fff;
                font: inherit; cursor: pointer;
            }
            button:hover { background: #1d4ed8; }
            .toggle { width: 100%; margin-top: 14px; padding: 8px; }
            .toggle[aria-pressed="true"] { background: #475569; }
            .directory { width: 100%; margin-top: 8px; padding: 8px; background: #eef2f7; color: #243047; }
            .directory:hover { background: #e2e8f0; }
            .min {
                width: 26px; height: 26px; padding: 0; border-radius: 6px;
                background: #eef2f7; color: #475569; font-size: 16px; line-height: 1;
            }
            .min:hover { background: #e2e8f0; }
            .mini {
                position: fixed; right: 20px; bottom: 20px;
                display: inline-flex; align-items: center; justify-content: center;
                width: auto; max-width: none; white-space: nowrap; overflow: hidden;
                padding: 8px 14px; border-radius: 999px;
                box-shadow: 0 4px 16px #0003; font: 14px/1.5 system-ui, sans-serif;
                opacity: 0; visibility: hidden;
                transform: translate(18px, 18px) scale(.5);
                transform-origin: bottom right;
                transition: opacity .2s ease, transform .34s cubic-bezier(.34, 1.56, .64, 1), visibility 0s linear .34s;
            }
            .mini.show {
                opacity: 1; visibility: visible;
                transform: translate(0, 0) scale(1);
                transition: opacity .2s ease, transform .34s cubic-bezier(.34, 1.56, .64, 1), visibility 0s linear 0s;
            }
            .mini-label { position: relative; z-index: 1; }
            .mini-fill {
                position: absolute; left: 0; bottom: 0; width: 0; height: 3px;
                background: #93c5fd; border-radius: 0 2px 2px 0;
                transition: width 1s cubic-bezier(.22, 1, .36, 1);
            }
            .progress {
                height: 6px; margin-top: 10px; border-radius: 999px;
                background: #eef2f7; overflow: hidden;
            }
            .progress i {
                display: block; width: 0; height: 100%; border-radius: inherit;
                background: linear-gradient(90deg, #60a5fa, #2563eb);
                transition: width 1s cubic-bezier(.22, 1, .36, 1);
            }
            .hint { margin: 8px 0 0; font-size: 12px; color: #64748b; }
            .status { margin: 10px 0 0; font-size: 12px; color: #64748b; overflow-wrap: anywhere; }
        </style>
        <section class="panel" aria-label="雨课堂自动阅读">
            <div class="head">
                <h2>雨课堂自动阅读</h2>
                <button class="min" type="button" title="最小化" aria-label="最小化">－</button>
            </div>
            <label for="interval">间隔时间（秒）</label>
            <input id="interval" type="number" min="0.1" step="any" inputmode="decimal">
            <p class="hint">未读页等待设定时间，已读页立即跳过，读完自动校验未读页</p>
            <button class="toggle" type="button" aria-pressed="false">开始</button>
            ${LIST_ROUTE.test(location.pathname) ? '' : '<button class="directory" type="button">返回目录</button>'}
            <div class="progress" role="progressbar" aria-label="阅读进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div>
            <p class="status" role="status">已暂停</p>
        </section>
        <button class="mini" type="button" title="展开面板"><span class="mini-label">自动阅读</span><i class="mini-fill"></i></button>
    `;
    document.documentElement.append(host);

    const panel = shadow.querySelector('.panel');
    const minButton = shadow.querySelector('.min');
    const miniButton = shadow.querySelector('.mini');
    const intervalInput = shadow.querySelector('#interval');
    const toggleButton = shadow.querySelector('.toggle');
    const directoryButton = shadow.querySelector('.directory');
    const status = shadow.querySelector('.status');
    const progressBar = shadow.querySelector('.progress');
    const progressFill = shadow.querySelector('.progress i');
    const miniLabel = shadow.querySelector('.mini-label');
    const miniFill = shadow.querySelector('.mini-fill');
    intervalInput.value = String(interval);
    let collapseTimer = null;

    function setStatus(text) {
        status.textContent = text;
    }

    function updateMiniLabel() {
        miniLabel.textContent = running ? '阅读中' : '自动阅读';
    }

    let progressTimer = null;
    let progressTarget = 0;
    let progressShown = 0;

    function renderProgress(value) {
        progressShown = Math.max(0, Math.min(100, value));
        progressFill.style.width = `${progressShown}%`;
        miniFill.style.width = `${progressShown}%`;
        progressBar.setAttribute('aria-valuenow', String(Math.round(progressShown)));
    }

    function setProgress(value) {
        progressTarget = Math.max(0, Math.min(100, value));
    }

    function startProgress() {
        stopProgress();
        renderProgress(0);
        progressTarget = 0;
        // 每秒推进一次，配合 CSS 非线性缓动，避免连续跳变。
        progressTimer = setInterval(() => {
            if (running && progressShown !== progressTarget) renderProgress(progressTarget);
        }, PROGRESS_STEP);
    }

    function stopProgress() {
        clearInterval(progressTimer);
        progressTimer = null;
    }

    function setMinimized(minimized, animate = true) {
        clearTimeout(collapseTimer);
        collapseTimer = null;

        if (minimized) {
            miniButton.classList.add('show');
            if (animate) {
                panel.classList.add('leaving');
                collapseTimer = setTimeout(() => {
                    panel.classList.add('hidden');
                    panel.classList.remove('leaving');
                }, 360);
            } else {
                panel.classList.add('hidden');
                panel.classList.remove('leaving');
            }
        } else {
            miniButton.classList.remove('show');
            if (animate) {
                panel.classList.add('leaving');
                panel.classList.remove('hidden');
                void panel.offsetWidth;
                panel.classList.remove('leaving');
            } else {
                panel.classList.remove('hidden');
                panel.classList.remove('leaving');
            }
        }
        GM_setValue('panelMinimized', minimized);
    }

    function takeContinueFlag() {
        try {
            const raw = sessionStorage.getItem('ytAutoContinue');
            if (raw !== null) sessionStorage.removeItem('ytAutoContinue');
            return raw !== null && Date.now() - Number(raw) < 120000;
        } catch (err) {
            return false;
        }
    }

    function markContinue() {
        try {
            sessionStorage.setItem('ytAutoContinue', String(Date.now()));
        } catch (err) {
            // 写入失败时只是不会自动续读下一个课件。
        }
    }

    function cancelRun() {
        generation += 1;
    }

    function sleep(ms, gen) {
        return new Promise((resolve) => {
            setTimeout(() => resolve(gen === generation), ms);
        });
    }

    async function waitFor(predicate, timeout, gen, step = 100) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            if (gen !== generation) return false;
            try {
                if (predicate()) return true;
            } catch (err) {
                // 页面切换时元素可能暂时不可访问，继续轮询。
            }
            await sleep(step, gen);
        }
        return false;
    }

    function stop(message) {
        running = false;
        cancelRun();
        stopProgress();
        toggleButton.textContent = '开始';
        toggleButton.setAttribute('aria-pressed', 'false');
        updateMiniLabel();
        if (message) setStatus(message);
    }

    function getContext() {
        const listMatch = location.pathname.match(LIST_ROUTE);
        const cardsMatch = location.pathname.match(CARDS_ROUTE);
        const classroomId = listMatch?.[1] || cardsMatch?.[1] ||
            String(localStorage.getItem('classroom_id') || localStorage.getItem('classroomId') || '');
        const universityId = String(localStorage.getItem('university_id') || '');
        const buildListUrl = () => {
            const params = new URLSearchParams();
            if (universityId) params.set('university_id', universityId);
            params.set('platform_id', '3');
            params.set('classroom_id', classroomId);
            return `${location.origin}/v2/web/studentLog/${classroomId}?${params.toString()}`;
        };

        let listUrl = '';
        if (listMatch && classroomId) {
            listUrl = buildListUrl();
            GM_setValue('listUrlV2', listUrl);
        } else {
            const saved = String(GM_getValue('listUrlV2', '') || '');
            if (saved) {
                try {
                    const savedClassroom = new URL(saved).pathname.match(LIST_ROUTE)?.[1];
                    if (!classroomId || !savedClassroom || savedClassroom === classroomId) listUrl = saved;
                } catch (err) {
                    // 保存的地址损坏时忽略，改用当前课堂重新拼接。
                }
            }
            if (!listUrl && classroomId) listUrl = buildListUrl();
        }
        return { classroomId, universityId, listUrl, activityId: cardsMatch?.[3] || '' };
    }

    function attemptedKey(classroomId) {
        return `attemptedV2:${classroomId}`;
    }

    function getAttempted(classroomId) {
        try {
            const parsed = JSON.parse(GM_getValue(attemptedKey(classroomId), '[]'));
            return Array.isArray(parsed) ? parsed.map(String) : [];
        } catch (err) {
            return [];
        }
    }

    function addAttempted(classroomId, activityId) {
        if (!classroomId || !activityId) return;
        const list = getAttempted(classroomId);
        const id = String(activityId);
        if (list.includes(id)) return;
        list.push(id);
        GM_setValue(attemptedKey(classroomId), JSON.stringify(list));
    }

    function clearAttempted(classroomId) {
        if (classroomId) GM_setValue(attemptedKey(classroomId), '[]');
    }

    function getCardInfo(card) {
        const vm = card.__vue__;
        if (!vm) return null;
        const parent = vm.$parent;
        const parentData = parent?.$props?.tableData;
        if (parentData && typeof parentData.type !== 'undefined') {
            return { data: parentData, props: parent.$props };
        }
        const ownData = vm.$props?.tableData;
        if (ownData && typeof ownData.type !== 'undefined') {
            return { data: ownData, props: vm.$props };
        }
        return null;
    }

    function listDataReady() {
        for (const card of document.querySelectorAll('section.activity__wrap')) {
            if (getCardInfo(card)) return true;
        }
        return false;
    }

    function collectCourseware(classroomId) {
        const seen = new Set();
        const items = [];
        for (const card of document.querySelectorAll('section.activity__wrap')) {
            const info = getCardInfo(card);
            if (!info) continue;
            const { data, props } = info;
            if (Number(data.type) !== 2) continue;

            const activityId = String(data.id ?? '');
            if (!activityId || seen.has(activityId)) continue;
            seen.add(activityId);

            const count = Number(data.count) || 0;
            const depth = Number(data.view?.depth) || 0;
            const done = data.view?.done === true || (count > 0 && depth >= count);
            if (done) continue;

            items.push({
                activityId,
                coursewareId: String(data.courseware_id ?? ''),
                title: String(data.title ?? ''),
                count,
                classroomId: String(props?.classroomid || classroomId || ''),
                courseId: String(props?.courseid || '')
            });
        }
        return items;
    }

    function coursewareUrl(item, fallbackClassroomId) {
        const classroomId = item.classroomId || fallbackClassroomId;
        const params = new URLSearchParams();
        if (item.courseId) params.set('cid', item.courseId);
        params.set('autoOpenPPT', '1');
        return `${location.origin}/v2/web/studentCards/${classroomId}/${encodeURIComponent(item.coursewareId)}/${encodeURIComponent(item.activityId)}?${params.toString()}`;
    }

    function getThumbs() {
        return [...document.querySelectorAll('.pptThumbsSwiper .swiper-slide')];
    }

    function getPptSwiper() {
        const el = document.querySelector('.pptSwiper');
        return el && el.swiper ? el.swiper : null;
    }

    function getActiveIndex() {
        const swiper = getPptSwiper();
        return swiper && Number.isInteger(swiper.activeIndex) ? swiper.activeIndex : -1;
    }

    function isVisible(el) {
        if (!el) return false;
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function countVisibleUnread() {
        return [...document.querySelectorAll('.pptThumbsSwiper .flag')]
            .filter((flag) => flag.textContent.includes('未读') && isVisible(flag)).length;
    }

    function isNextUnread(index) {
        const thumb = getThumbs()[index];
        const flag = thumb?.querySelector('.flag');
        if (flag && flag.textContent.trim()) {
            return flag.textContent.includes('未读') && isVisible(flag);
        }
        return countVisibleUnread() > 0;
    }

    function clickVisibleText(texts) {
        const nodes = document.querySelectorAll('button, .el-button, [role="button"]');
        for (const node of nodes) {
            const text = (node.textContent || '').trim();
            if (!text || !texts.some((item) => text.includes(item))) continue;
            if (!isVisible(node)) continue;
            node.click();
            return true;
        }
        return false;
    }

    function dispatchKey(key) {
        const target = document.body || document.documentElement;
        const options = { key, code: key, keyCode: 39, which: 39, bubbles: true, cancelable: true };
        target.dispatchEvent(new KeyboardEvent('keydown', options));
        target.dispatchEvent(new KeyboardEvent('keyup', options));
    }

    async function goToPage(index, gen) {
        const target = getThumbs()[index];
        if (!target) return false;

        try {
            (target.querySelector('.container') || target).click();
        } catch (err) {
            // 继续尝试 Swiper 或键盘翻页。
        }
        if (await waitFor(() => getActiveIndex() === index, 1500, gen, 60)) return true;

        const swiper = getPptSwiper();
        if (typeof swiper?.slideTo === 'function') {
            swiper.slideTo(index);
            if (await waitFor(() => getActiveIndex() === index, 1500, gen, 60)) return true;
        }
        if (typeof swiper?.slideNext === 'function') {
            const before = getActiveIndex();
            swiper.slideNext();
            if (await waitFor(() => getActiveIndex() !== before, 1500, gen, 60)) return true;
        }
        const before = getActiveIndex();
        dispatchKey('ArrowRight');
        return waitFor(() => getActiveIndex() !== before, 1500, gen, 60);
    }

    function hasUnreadMark(index) {
        const flag = getThumbs()[index]?.querySelector('.flag');
        // 已读页的标记元素仍保留“未读”文字，只是被隐藏，必须按可见性判断。
        return !!flag && flag.textContent.includes('未读') && isVisible(flag);
    }

    async function waitUnreadMarkGone(index, timeout, gen) {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
            if (gen !== generation) return false;
            if (!hasUnreadMark(index)) return true;
            await sleep(150, gen);
        }
        return !hasUnreadMark(index);
    }

    function unreadIndices() {
        const unread = [];
        getThumbs().forEach((thumb, index) => {
            if (hasUnreadMark(index)) unread.push(index);
        });
        return unread;
    }

    async function verifyUnreadPages(gen) {
        for (let round = 0; round < VERIFY_ROUNDS; round += 1) {
            const unread = unreadIndices();
            if (!unread.length) return [];
            setStatus(`校验：${unread.length} 页仍为未读，正在补读…`);

            for (const index of unread) {
                if (gen !== generation) return null;
                if (getActiveIndex() !== index) {
                    const moved = await goToPage(index, gen);
                    if (gen !== generation) return null;
                    if (!moved) return unread;
                }
                const startAt = Date.now();
                await waitUnreadMarkGone(index, VERIFY_TIMEOUT, gen);
                if (gen !== generation) return null;
                const remain = Math.max(0, interval * 1000 - (Date.now() - startAt));
                if (remain > 0 && !(await sleep(remain, gen))) return null;
            }
        }
        return unreadIndices();
    }

    async function runListStep(gen) {
        const ctx = getContext();
        if (!ctx.listUrl) {
            stop('无法确定课程目录地址，请从课程目录页启动');
            return;
        }

        setStatus('正在扫描未完成课件…');
        const ready = await waitFor(listDataReady, 30000, gen, 200);
        if (gen !== generation) return;
        if (!ready) {
            stop('未找到课件列表，请刷新页面后重试');
            return;
        }

        await sleep(400, gen);
        if (gen !== generation) return;

        const unfinished = collectCourseware(ctx.classroomId);
        if (!unfinished.length) {
            stop('当前没有未完成的课件');
            return;
        }

        const attempted = new Set(getAttempted(ctx.classroomId));
        const target = unfinished.find((item) => !attempted.has(item.activityId) && item.coursewareId);
        if (!target) {
            stop('未完成课件都已尝试，点“开始”可重新扫描');
            return;
        }

        setStatus(`进入课件：${target.title}`);
        const url = coursewareUrl(target, ctx.classroomId);
        await sleep(800, gen);
        if (gen !== generation) return;
        addAttempted(ctx.classroomId, target.activityId);
        markContinue();
        location.href = url;
    }

    async function runReader(gen) {
        const ctx = getContext();
        setStatus('正在等待课件加载…');
        const ready = await waitFor(() => getThumbs().length > 0 && getActiveIndex() >= 0, 30000, gen, 200);
        if (gen !== generation) return;
        if (!ready) {
            stop('未找到课件页面，请确认课件已打开');
            return;
        }

        clickVisibleText(['继续观看']);
        // 等左侧页签的“未读”标记渲染完成，避免首轮误判为已读。
        await waitFor(() => document.querySelectorAll('.pptThumbsSwiper .flag').length > 0, 5000, gen, 100);
        if (gen !== generation) return;

        let total = getThumbs().length;
        let index = Math.max(0, getActiveIndex());
        setProgress(((index + 1) / total) * 100);
        const firstAt = Date.now();
        setStatus(`第 ${index + 1}/${total} 页 · 等待“未读”标记消失`);
        // 刚进入课件时页面尚未加载完，等首页的“未读”标记真正消失再翻页。
        const firstCleared = await waitUnreadMarkGone(index, FIRST_PAGE_TIMEOUT, gen);
        if (gen !== generation) return;
        const firstRemain = Math.max(interval * 1000, 1000) - (Date.now() - firstAt);
        if (firstRemain > 0 && !(await sleep(firstRemain, gen))) return;
        if (!firstCleared) setStatus('首页“未读”标记未消失，按设定间隔继续');

        while (gen === generation) {
            total = getThumbs().length;
            index = getActiveIndex();
            if (index < 0) break;
            const next = index + 1;
            if (next >= total) break;

            const nextUnread = isNextUnread(next);
            const waitMs = nextUnread ? interval * 1000 : QUICK_DELAY;
            setStatus(`第 ${next + 1}/${total} 页${nextUnread ? '' : ' · 快速跳过'}`);

            const moved = await goToPage(next, gen);
            if (gen !== generation) return;
            if (!moved) {
                stop('翻页失败，已停止。请手动检查课件页面');
                return;
            }
            setProgress(((next + 1) / total) * 100);
            if (!(await sleep(waitMs, gen))) return;
        }

        if (gen !== generation) return;
        const finishedTotal = getThumbs().length;
        const lastIndex = getActiveIndex();
        if (lastIndex >= 0 && lastIndex + 1 >= finishedTotal) {
            setProgress(100);
            setStatus('最后一页停留 2 秒，等待记录保存…');
            if (!(await sleep(LAST_PAGE_HOLD, gen))) return;
        }
        setStatus('正在校验未读页…');
        const leftover = await verifyUnreadPages(gen);
        if (gen !== generation) return;
        const leftoverCount = Array.isArray(leftover) ? leftover.length : 0;
        const summary = leftoverCount ? `，${leftoverCount} 页仍为未读` : '，校验通过';
        setStatus(`已读完 ${finishedTotal} 页${summary}，正在返回目录…`);
        addAttempted(ctx.classroomId, ctx.activityId);
        if (!(await sleep(700, gen))) return;
        if (ctx.listUrl) {
            markContinue();
            location.href = ctx.listUrl;
        } else {
            stop(`已读完，但未能确定目录地址${leftoverCount ? `（${leftoverCount} 页未读）` : ''}`);
        }
    }

    function applyInterval() {
        const value = intervalInput.valueAsNumber;
        if (!Number.isFinite(value) || value < 0.1 || value * 1000 > 2147483647) {
            intervalInput.setAttribute('aria-invalid', 'true');
            setStatus('请输入至少 0.1 秒的有效间隔');
            return false;
        }
        intervalInput.removeAttribute('aria-invalid');
        interval = value;
        GM_setValue('intervalV2', interval);
        return true;
    }

    function start() {
        if (!applyInterval()) return;
        cancelRun();
        running = true;
        startProgress();
        toggleButton.textContent = '暂停';
        toggleButton.setAttribute('aria-pressed', 'true');
        updateMiniLabel();
        const gen = generation;

        if (LIST_ROUTE.test(location.pathname)) {
            runListStep(gen);
        } else {
            runReader(gen);
        }
    }

    intervalInput.addEventListener('input', applyInterval);
    minButton.addEventListener('click', () => setMinimized(true));
    miniButton.addEventListener('click', () => setMinimized(false));
    directoryButton?.addEventListener('click', () => {
        const { listUrl } = getContext();
        if (!listUrl) {
            setStatus('未能确定课程目录地址');
            return;
        }
        if (running) markContinue();
        location.href = listUrl;
    });
    toggleButton.addEventListener('click', () => {
        if (running) {
            stop('已暂停');
            return;
        }
        // 手动开始视为重新扫描：清空“已尝试”记录。
        if (LIST_ROUTE.test(location.pathname)) {
            clearAttempted(getContext().classroomId);
        }
        start();
    });

    const continueRun = takeContinueFlag();
    setMinimized(GM_getValue('panelMinimized', false) === true, false);
    updateMiniLabel();
    setStatus('已暂停');

    if (continueRun) start();
})();
