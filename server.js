const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==========================================
// 📌 1. ตั้งค่าตัวแปรระบบและ Global Variables
// ==========================================
const ADMIN_LIST = ['U4a0d60e9af37aa9fe66cf3e97d01cddb']; // 👈 ใส่ LINE User ID ของแอดมิน
const COMMISSION_RATE = 0.00; // ค่าน้ำ 5% (ถ้าไม่ต้องการให้ใส่ 0)

let usersWallets = {};
let nextMemberId = 1;

// ตัวแปรตั้งค่าระบบแบบตายตัว (บันทึกไว้ตลอด)
let defaultMaxLegs = 8;     // ค่าเริ่มต้น 8 ขา
let defaultBetPrice = 10;   // ค่าเริ่มต้น ขาละ 10 บาท

// ตัวแปรควบคุมรอบการเล่น
let isRoundOpen = false;
let occupiedLegs = {};     // เก็บสถานะขา { 1: userId, 2: userId, ... }
let roundBets = {};        // เก็บรายละเอียดการแทงของแต่ละคน
let pendingResults = null;

// ==========================================
// 📌 2. ฟังก์ชันแปลงผลไพ่รูปแบบใหม่ ( parseNewResult )
// ==========================================
// ตัวอย่างอินพุต: "7.5", "4/", "9k", "9/2" -> คืนค่า score (float) และ deng (int)
function parseCardValue(token) {
    if (!token) return { score: 0, deng: 1 };
    let str = token.trim().toLowerCase();
    
    let deng = 1;
    // ถ้ามีเครื่องหมาย / หรือ k หรือ d ตัวท้าย
    if (str.includes('/')) {
        deng = 2;
        str = str.replace('/', '');
    } else if (str.endsWith('d')) {
        deng = 2;
        str = str.slice(0, -1);
    } else if (str.endsWith('k')) {
        deng = 3;
        str = str.slice(0, -1);
    }

    let score = parseFloat(str);
    if (isNaN(score)) score = 0;

    return { score, deng };
}

app.get('/', (req, res) => {
    res.send('LINE Bot Server is running!');
});

// ==========================================
// 📌 3. LINE Webhook Handler
// ==========================================
app.post('/callback', async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === 'message' && event.message.type === 'text') {
            const replyToken = event.replyToken;
            const source = event.source;
            const userId = source.userId;
            const groupId = source.groupId;
            const roomId = source.roomId;

            const originalMsg = event.message.text.trim();
            const userMsg = originalMsg.toLowerCase();
            const isAdmin = ADMIN_LIST.includes(userId);
            let replyMessageObject = null;

            // 🆔 [คำสั่งเช็ก ID]
            if (userMsg === 'id' || userMsg === 'myid') {
                let idInfoText = `🆔 **ข้อมูล LINE ID**\n------------------------\n`;
                if (userId) idInfoText += `👤 **User ID:**\n${userId}\n\n`;
                if (groupId) idInfoText += `👥 **Group ID:**\n${groupId}\n\n`;
                if (roomId) idInfoText += `🏠 **Room ID:**\n${roomId}\n\n`;
                idInfoText += `📌 *วาง User ID ในตัวแปร ADMIN_LIST ได้เลยครับ*`;

                replyMessageObject = { type: 'text', text: idInfoText };
            }
            // 🧽 [คำสั่งแอดมิน] ล้างระบบ
            else if (userMsg === 'ล้างระบบ') {
                if (!isAdmin) {
                    replyMessageObject = { type: 'text', text: "❌ คุณไม่ใช่แอดมิน ไม่มีสิทธิ์ใช้คำสั่งนี้ครับ" };
                } else {
                    usersWallets = {}; nextMemberId = 1; isRoundOpen = false; 
                    occupiedLegs = {}; roundBets = {}; pendingResults = null;
                    replyMessageObject = { type: 'text', text: "👑 [แอดมิน] ♻️ ล้างระบบสมาชิกและกระดานเรียบร้อยแล้วครับ!" };
                }
            }
            // ⚙️ [คำสั่งแอดมิน] ตั้งค่าขาและราคาแบบตายตัว
            else if (originalMsg.startsWith('ตั้งค่า') || originalMsg.startsWith('เพิ่ม') || originalMsg.startsWith('เซ็ตค่า')) {
                if (!isAdmin) {
                    replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                } else {
                    let matches = originalMsg.match(/\d+/g);
                    if (matches && matches.length >= 2) {
                        defaultMaxLegs = parseInt(matches[0]);
                        defaultBetPrice = parseInt(matches[1]);
                        let requiredHolding = (defaultMaxLegs - 1) * 2 * defaultBetPrice;

                        replyMessageObject = { 
                            type: 'text', 
                            text: `⚙️ [แอดมิน - ตั้งค่าระบบสำเร็จ]\n------------------------\n🎲 ขาทั้งหมด: **${defaultMaxLegs} ขา**\n💵 ราคาเดิมพัน: **ขาละ ${defaultBetPrice} บาท**\n🔒 ค้ำประกันต่อขา: **${requiredHolding} บาท**\n\n📌 *บันทึกค่าแล้ว! สามารถใช้คำสั่ง 'o' เปิดรอบได้ตลอดเลยครับ*` 
                        };
                    } else {
                        replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ รูปแบบไม่ถูกต้อง ตัวอย่าง: **ตั้งค่า 8 10** หรือ **เพิ่ม 8 ราคา 10**` };
                    }
                }
            }
            // ระบบสมาชิก + คำสั่งอื่นๆ
            else {
                if (!usersWallets[userId]) {
                    usersWallets[userId] = { 
                        memberNumber: nextMemberId,
                        memberTitle: `สมาชิกที่ ${nextMemberId}`,
                        name: "ผู้เล่นทั่วไป", 
                        balance: 0,
                        isLockWithdraw: false,
                        pendingWithdrawAmount: 0
                    };
                    nextMemberId++;
                }
                
                const user = usersWallets[userId];
                const mentionText = `👤 ${user.memberTitle} `;

                // ดึงชื่อเล่นชั่วคราว
                if (event.message.mention && event.message.mention.mentions && event.message.mention.mentions.length > 0) {
                    let firstMention = event.message.mention.mentions[0];
                    if (firstMention.userId === userId) {
                        let parts = originalMsg.split(/\s+/);
                        let rawName = parts.find(p => p.includes('@'));
                        if (rawName) user.name = rawName.replace('@', '').trim();
                    }
                }

                // ==========================================
                // PART 1: ระบบเติมเงิน / ถอนเงิน / เช็กยอด
                // ==========================================
                if (originalMsg.startsWith('เติม')) {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else {
                        let targetUserId = null;
                        let amount = 0;
                        const moneyMatch = originalMsg.match(/\d+$/);
                        if (moneyMatch) amount = parseInt(moneyMatch[0]);

                        let cleanText = originalMsg.replace('เติม', '').trim();
                        if (moneyMatch) cleanText = cleanText.substring(0, cleanText.lastIndexOf(moneyMatch[0])).trim();
                        let searchKeyword = cleanText.replace('@', '').trim().toLowerCase().replace(/\s+/g, '');

                        if (event.message.mention && event.message.mention.mentions && event.message.mention.mentions.length > 0) {
                            targetUserId = event.message.mention.mentions[0].userId;
                        } else if (searchKeyword) {
                            for (let uid in usersWallets) {
                                let u = usersWallets[uid];
                                if (u.memberTitle.toLowerCase().replace(/\s+/g, '') === searchKeyword || u.memberNumber.toString() === searchKeyword || u.name.toLowerCase().replace(/\s+/g, '').includes(searchKeyword)) {
                                    targetUserId = uid;
                                    break;
                                }
                            }
                        }

                        if (!targetUserId || isNaN(amount) || amount <= 0) {
                            replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ เติมเงินไม่สำเร็จ\n📌 รูปแบบ: **เติม [เลขสมาชิก] [จำนวนเงิน]**` };
                        } else {
                            usersWallets[targetUserId].balance += amount;
                            let tUser = usersWallets[targetUserId];
                            replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ✅ เติมเงินสำเร็จ! +${amount} บาท ให้แก่ ${tUser.memberTitle}\n💰 ยอดเงินคงเหลือ: ${tUser.balance} บาท` };
                        }
                    }
                }
                else if (userMsg.startsWith('ถอน')) {
                    if (user.isLockWithdraw) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ ไม่สามารถแจ้งถอนซ้ำได้! มีรายการถอนค้างอยู่ ${user.pendingWithdrawAmount} บาท` };
                    } else {
                        const amount = parseInt(userMsg.replace('ถอน', ''));
                        if (!isNaN(amount) && amount > 0) {
                            if (user.balance < amount) {
                                replyMessageObject = { type: 'text', text: `${mentionText} ❌ ยอดเงินในระบบไม่พอ (มีอยู่ ${user.balance} บ.)` };
                            } else {
                                user.isLockWithdraw = true;
                                user.pendingWithdrawAmount = amount;
                                replyMessageObject = {
                                    type: 'text',
                                    text: `🔔 [ระบบรับเรื่องแจ้งถอน]\n👤 ${user.memberTitle}\n💰 ยอดที่ต้องการถอน: **${amount}** บาท\n🔒 Status: ล็อกกระเป๋าชั่วคราว`
                                };
                            }
                        }
                    }
                }
                else if (originalMsg.startsWith('Y ') || originalMsg.startsWith('y ')) {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน` };
                    } else {
                        const parts = originalMsg.trim().split(/\s+/);
                        let memberNum = parts[1] ? parseInt(parts[1]) : 0;
                        let targetUserId = null;

                        for (let uid in usersWallets) {
                            if (usersWallets[uid].memberNumber === memberNum) {
                                targetUserId = uid;
                                break;
                            }
                        }

                        if (!targetUserId) {
                            replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ ไม่พบสมาชิกเลขนี้` };
                        } else {
                            const targetUser = usersWallets[targetUserId];
                            if (!targetUser.isLockWithdraw || targetUser.pendingWithdrawAmount <= 0) {
                                replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ❌ สมาชิกไม่ได้แจ้งถอนค้างไว้` };
                            } else {
                                let amount = targetUser.pendingWithdrawAmount;
                                targetUser.balance -= amount;
                                targetUser.isLockWithdraw = false;
                                targetUser.pendingWithdrawAmount = 0;
                                replyMessageObject = { 
                                    type: 'text', 
                                    text: `👑 [แอดมิน] ✅ อนุมัติถอนสำเร็จ!\n👤 สมาชิกที่ ${targetUser.memberNumber}\n📉 หักยอด: -${amount} บาท\n💰 ยอดคงเหลือ: ${targetUser.balance} บาท` 
                                };
                            }
                        }
                    }
                }
                else if (userMsg === 'c') {
                    replyMessageObject = { type: 'text', text: `👤 ${user.memberTitle}\n💰 ยอดเงินคงเหลือ: ${user.balance} บาท` };
                }

                // ==========================================
                // PART 2: เปิดรอบ (o) / ปิดรอบ (x) / คืนโพย (r)
                // ==========================================
                else if (userMsg === 'o') {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else {
                        isRoundOpen = true; 
                        occupiedLegs = {}; 
                        roundBets = {}; 
                        pendingResults = null;

                        let requiredHolding = (defaultMaxLegs - 1) * 2 * defaultBetPrice;

                        replyMessageObject = { 
                            type: 'text', 
                            text: `🟢 [เปิดรับเดิมพันรอบใหม่]\n------------------------\n🎲 ขาทั้งหมด: **1 ถึง ${defaultMaxLegs}**\n💵 ราคาเดิมพัน: **ขาละ ${defaultBetPrice} บาท**\n🔒 ค้ำประกันต่อขา: **${requiredHolding} บาท**\n\n📌 *พิมพ์เลือกขาที่ต้องการได้เลย เช่น: 1, 2, 5 (ใครไวกว่าได้ก่อน!)*` 
                        };
                    }
                }
                else if (userMsg === 'x') {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else {
                        if (!isRoundOpen) {
                            replyMessageObject = { type: 'text', text: "⚠️ รอบเดิมพันปิดอยู่แล้ว" };
                        } else {
                            isRoundOpen = false;
                            let summary = `🔴 [ปิดรับเดิมพันแล้ว]\n🎲 ขาทั้งหมด: ${defaultMaxLegs} ขา (ขาละ ${defaultBetPrice} บ.)\n📋 [รายการขาที่มีผู้ลงแข่งขัน]:\n`;
                            let hasData = false;
                            
                            for (let leg = 1; leg <= defaultMaxLegs; leg++) {
                                if (occupiedLegs[leg]) {
                                    let u = usersWallets[occupiedLegs[leg]];
                                    summary += `▪️ ขา ${leg}: ${u.memberTitle}\n`;
                                    hasData = true;
                                } else {
                                    summary += `▫️ ขา ${leg}: [ว่าง]\n`;
                                }
                            }
                            
                            if (!hasData) summary += "❌ ไม่มีใครลงเดิมพันในรอบนี้\n";
                            replyMessageObject = { type: 'text', text: summary + `\n⏳ รอผล` };
                        }
                    }
                }
                else if (userMsg === 'r') {
                    if (user.isLockWithdraw) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ กระเป๋าโดนล็อก` };
                    } else if (!isRoundOpen) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ ปิดรอบไปแล้ว ยกเลิกไม่ได้` };
                    } else if (!roundBets[userId]) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่มีโพยในรอบนี้` };
                    } else {
                        const savedBet = roundBets[userId];
                        
                        // เคลียร์ขาออกจากกระดาน
                        for (let leg in savedBet.khasDetails) {
                            delete occupiedLegs[leg];
                        }

                        user.balance += savedBet.holding; 
                        delete roundBets[userId]; 
                        replyMessageObject = { type: 'text', text: `${mentionText} 🔄 คืนโพยและยกเลิกขาเรียบร้อย!\n💰 ยอดเงินคงเหลือ: ${user.balance} บาท` };
                    }
                }

                // ==========================================
                // PART 3: ตรวจผลไพ่แบบใหม่ (ขึ้นต้นด้วย >) / คิดเงิน (ok)
                // ==========================================
                else if (originalMsg.startsWith('>')) {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else {
                        // แยกข้อความด้วยการเว้นบรรทัด และเว้นวรรค
                        let rawContent = originalMsg.substring(1).trim();
                        let rawTokens = rawContent.split(/[\s\n]+/);

                        let parsedList = [];
                        for (let token of rawTokens) {
                            if (token.trim() !== '') {
                                parsedList.push(parseCardValue(token));
                            }
                        }

                        pendingResults = { parsedList };
                        let previewText = `🐓 [ตรวจผลคะแนนตีไก่]\n------------------------\n`;
                        
                        for (let i = 0; i < parsedList.length; i++) {
                            let legNum = i + 1;
                            let cardRes = parsedList[i];
                            let owner = occupiedLegs[legNum] ? usersWallets[occupiedLegs[legNum]].memberTitle : "ไม่มีผู้เล่น";
                            let dengStr = cardRes.deng > 1 ? ` (${cardRes.deng} เด้ง)` : '';
                            previewText += `🔹 ขา ${legNum} (${owner}): **${cardRes.score} แต้ม**${dengStr}\n`;
                        }

                        replyMessageObject = { type: 'text', text: previewText + `\n📢 หากถูกต้องพิมพ์ **OK** เพื่อคิดเงิน` };
                    }
                }
                else if (userMsg === 'ok') {
                    if (!isAdmin) {
                        replyMessageObject = { type: 'text', text: `${mentionText} ❌ คุณไม่ใช่แอดมิน!` };
                    } else if (!pendingResults) {
                        replyMessageObject = { type: 'text', text: `👑 [แอดมิน] ⚠️ ไม่มีผลคะแนนค้างในระบบ` };
                    } else {
                        let { parsedList } = pendingResults;
                        let parsedCards = {};
                        for (let i = 0; i < parsedList.length; i++) {
                            parsedCards[i + 1] = parsedList[i];
                        }

                        let summaryText = `📊 [สรุปผลคิดเงินป๊อกเด้งตีไก่]\n------------------------\n`;

                        for (let uid in roundBets) {
                            let savedBet = roundBets[uid];
                            let pUser = usersWallets[uid];
                            let totalNetWinLoss = 0;
                            let legReportText = "";

                            let myLegs = Object.keys(savedBet.khasDetails).map(Number);

                            for (let myLeg of myLegs) {
                                let myCard = parsedCards[myLeg];
                                if (!myCard) continue;

                                let legWinLoss = 0;

                                // ชนไพ่กับขาอื่นที่มีคนลงเล่นเท่านั้น
                                for (let oppLeg in occupiedLegs) {
                                    oppLeg = parseInt(oppLeg);
                                    if (myLeg === oppLeg) continue; // ไม่ชนขาตัวเอง

                                    let oppCard = parsedCards[oppLeg];
                                    if (!oppCard) continue;

                                    let bet = defaultBetPrice;

                                    if (myCard.score > oppCard.score) {
                                        let winAmt = bet * myCard.deng;
                                        let profit = winAmt * (1 - COMMISSION_RATE);
                                        legWinLoss += profit;
                                    } else if (myCard.score < oppCard.score) {
                                        let loseAmt = bet * oppCard.deng;
                                        legWinLoss -= loseAmt;
                                    }
                                }

                                totalNetWinLoss += legWinLoss;
                                let sign = legWinLoss >= 0 ? `+${legWinLoss.toFixed(1)}` : `${legWinLoss.toFixed(1)}`;
                                legReportText += `    ▪️ ขา ${myLeg} (${myCard.score} แต้ม): ${sign} บ.\n`;
                            }

                            let finalReturn = savedBet.holding + totalNetWinLoss;
                            pUser.balance += finalReturn;

                            let overallSign = totalNetWinLoss >= 0 ? `+${totalNetWinLoss.toFixed(1)}` : `${totalNetWinLoss.toFixed(1)}`;
                            summaryText += `👤 ${pUser.memberTitle}:\n${legReportText}    🏆 ผลรวมรอบนี้: **${overallSign} บาท**\n    💳 ยอดเงินคงเหลือล่าสุด: ${pUser.balance.toFixed(1)} บาท\n------------------------\n`;
                        }

                        replyMessageObject = { type: 'text', text: summaryText + `✨ เคลียร์ยอดเรียบร้อย! พิมพ์ o เพื่อเปิดรอบถัดไป` };
                        
                        // 🔄 เคลียร์ข้อมูลขา เพื่อเตรียมเปิดรอบถัดไป
                        isRoundOpen = false;
                        occupiedLegs = {};
                        roundBets = {}; 
                        pendingResults = null; 
                    }
                }
                else if (userMsg === 'no') {
                    if (isAdmin) {
                        pendingResults = null; 
                        replyMessageObject = { type: 'text', text: `👑 [แอดมิน] 🛑 ยกเลิกผลคะแนนแล้ว ส่งผลคะแนนใหม่ได้เลย` };
                    }
                }

                // ==========================================
                // PART 4: ผู้เล่นส่งคำสั่งเลือกขา (เช่น "1", "2,3")
                // ==========================================
                else {
                    let requestedLegs = originalMsg.match(/\d+/g);
                    if (requestedLegs && requestedLegs.length > 0) {
                        requestedLegs = requestedLegs.map(Number);

                        if (user.isLockWithdraw) {
                            replyMessageObject = { type: 'text', text: `${mentionText} ❌ ไม่สามารถแทงได้! กระเป๋าถูกล็อกชั่วคราว` };
                        } else if (!isRoundOpen) {
                            replyMessageObject = { type: 'text', text: `${mentionText} ❌ ยังไม่เปิดรอบ!` };
                        } else {
                            let invalidLegs = [];
                            let alreadyOccupiedLegs = [];
                            let validLegsToTake = [];

                            for (let leg of requestedLegs) {
                                if (leg < 1 || leg > defaultMaxLegs) {
                                    invalidLegs.push(leg);
                                } else if (occupiedLegs[leg] && occupiedLegs[leg] !== userId) {
                                    alreadyOccupiedLegs.push(leg);
                                } else if (!occupiedLegs[leg]) {
                                    validLegsToTake.push(leg);
                                }
                            }

                            if (invalidLegs.length > 0) {
                                replyMessageObject = { type: 'text', text: `${mentionText} ❌ ขา [${invalidLegs.join(', ')}] ไม่มีในระบบ! (รอบนี้เปิด 1 ถึง ${defaultMaxLegs} ขา)` };
                            } else if (alreadyOccupiedLegs.length > 0) {
                                replyMessageObject = { type: 'text', text: `${mentionText} ❌ ขา [${alreadyOccupiedLegs.join(', ')}] มีคนลงแล้ว! ไม่สามารถลงซ้ำได้` };
                            } else if (validLegsToTake.length > 0) {
                                // 📐 สูตรเงินค้ำประกัน: (ขาทั้งหมด - 1) * 2 * ราคาต่อขา
                                let requiredHoldingPerLeg = (defaultMaxLegs - 1) * 2 * defaultBetPrice;
                                let totalRequiredHolding = requiredHoldingPerLeg * validLegsToTake.length;

                                if (user.balance < totalRequiredHolding) {
                                    replyMessageObject = { 
                                        type: 'text', 
                                        text: `${mentionText} ❌ ยอดเงินไม่พอค้ำประกัน!\n💡 ต้องมีเงินค้ำประกันอย่างน้อย **${totalRequiredHolding} บาท** (ขาละ ${requiredHoldingPerLeg} บาท)\n💳 ยอดเงินของคุณคงเหลือ: ${user.balance} บาท` 
                                    };
                                } else {
                                    if (!roundBets[userId]) {
                                        roundBets[userId] = { betPerKha: defaultBetPrice, holding: 0, khasDetails: {} };
                                    }

                                    validLegsToTake.forEach(k => {
                                        occupiedLegs[k] = userId;
                                        roundBets[userId].khasDetails[k] = true;
                                    });

                                    roundBets[userId].holding += totalRequiredHolding;
                                    user.balance -= totalRequiredHolding;

                                    replyMessageObject = { 
                                        type: 'text', 
                                        text: `${mentionText} 🐓 [ลงขาสำเร็จ]\n📌 ขาที่เลือก: **[${validLegsToTake.join(', ')}]**\n💵 ราคาเดิมพัน: ขาละ ${defaultBetPrice} บ.\n🔒 หักค้ำประกัน: ${totalRequiredHolding} บ.\n💳 ยอดเงินคงเหลือ: ${user.balance} บาท` 
                                    };
                                }
                            }
                        }
                    }
                }
            }

            // ส่งข้อความตอบกลับไปยัง LINE
            if (replyMessageObject) {
                try {
                    await fetch('https://api.line.me/v2/bot/message/reply', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`
                        },
                        body: JSON.stringify({
                            replyToken: replyToken,
                            messages: [replyMessageObject]
                        })
                    });
                } catch (err) {
                    console.error('Error sending message:', err);
                }
            }
        }
    }
    res.sendStatus(200);
});

// ==========================================
// 📌 4. กำหนด Port สำหรับ Render
// ==========================================
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
