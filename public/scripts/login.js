/*
 * Bittorrent Client using Qt and libtorrent.
 * Copyright (C) 2019-2024  Mike Tzou (Chocobo1)
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation; either version 2
 * of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA.
 *
 * In addition, as a special exception, the copyright holders give permission to
 * link this program with the OpenSSL project's "OpenSSL" library (or with
 * modified versions of it that use the same license as the "OpenSSL" library),
 * and distribute the linked executables. You must obey the GNU General Public
 * License in all respects for all of the code used other than "OpenSSL".  If you
 * modify file(s), you may extend this exception to your version of the file(s),
 * but you are not obligated to do so. If you do not wish to do so, delete this
 * exception statement from your version.
 */

"use strict";

// "Keep me logged in" (Mobile-qbit): qBittorrent forgets every login when it restarts and when
// the session timeout passes without requests, e.g. while the phone is locked. The username and
// password are saved in this browser and sent again when the login page shows up.
// Logging out forgets them (mocha-init.js).
const SAVED_LOGIN_KEY = "qbt_mobileSavedLogin";
// The time of this tab's last login. The login page showing up again right after a login means
// that the browser didn't keep qBittorrent's cookie: logging in again would reload forever.
const LAST_LOGIN_KEY = "qbt_mobileLastLogin";
const LOGIN_LOOP_TIME = 10000;

const readSavedLogin = () => {
    try {
        const savedLogin = JSON.parse(localStorage.getItem(SAVED_LOGIN_KEY));
        if ((typeof savedLogin?.username === "string") && (typeof savedLogin?.password === "string"))
            return savedLogin;
    }
    catch (err) {
        console.error(err);
    }
    return null;
};

const writeSavedLogin = (savedLogin) => {
    try {
        if (savedLogin === null)
            localStorage.removeItem(SAVED_LOGIN_KEY);
        else
            localStorage.setItem(SAVED_LOGIN_KEY, JSON.stringify(savedLogin));
    }
    catch (err) {
        console.error(err);
    }
};

const isRightAfterLogin = () => {
    try {
        return (Date.now() - Number(sessionStorage.getItem(LAST_LOGIN_KEY))) < LOGIN_LOOP_TIME;
    }
    catch (err) {
        console.error(err);
        return true;
    }
};

const login = (username, password, keepLoggedIn) => {
    const errorMsgElement = document.getElementById("error_msg");
    errorMsgElement.textContent = ""; // clear previous error

    fetch("api/v2/auth/login", {
            method: "POST",
            body: new URLSearchParams({
                username: username,
                password: password
            })
        })
        .then(async (response) => {
                if (response.ok) {
                    writeSavedLogin(keepLoggedIn ? { username: username, password: password } : null);
                    try {
                        sessionStorage.setItem(LAST_LOGIN_KEY, Date.now());
                    }
                    catch (err) {
                        console.error(err);
                    }

                    location.replace(location); // redirect
                    location.reload(true);
                }
                else {
                    // wrong username or password: the saved ones are outdated
                    if (response.status === 401) {
                        writeSavedLogin(null);
                        document.getElementById("password").value = "";
                    }

                    const responseText = await response.text();
                    errorMsgElement.textContent = `QBT_TR(Invalid Username or Password.)QBT_TR[CONTEXT=Login]\nQBT_TR(Server response:)QBT_TR[CONTEXT=Login] ${responseText}`;
                }
            },
            (error) => {
                errorMsgElement.textContent = `QBT_TR(Unable to log in, server is probably unreachable.)QBT_TR[CONTEXT=Login]\n${error}`;
            });
};

const submitLoginForm = (event) => {
    event.preventDefault();

    const usernameElement = document.getElementById("username");
    const passwordElement = document.getElementById("password");
    login(usernameElement.value, passwordElement.value, document.getElementById("keepLoggedIn").checked);

    passwordElement.value = ""; // clear previous value
};

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginform");
    loginForm.method = "POST";
    loginForm.addEventListener("submit", submitLoginForm);

    const savedLogin = readSavedLogin();
    if (savedLogin === null)
        return;

    // filled in, so that the login button works if this login fails, e.g. while offline
    document.getElementById("username").value = savedLogin.username;
    document.getElementById("password").value = savedLogin.password;
    document.getElementById("keepLoggedIn").checked = true;
    if (!isRightAfterLogin())
        login(savedLogin.username, savedLogin.password, true);
});
