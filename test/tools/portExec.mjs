// 依埠找監聽行程之測試夾具: 注入 wsemi execProcessPortPidsSync 之 opt.exec 用的替身(spawnSync 形)與固定輸出
//   exec 格式: (prog, args, { src, timeout, maxBuffer }) => { status, stdout, error }, src 為 'netstat' 或 'powershell'
//   固定輸出之格式取自 wsemi 1.9.32(netstat -ano 之列; Get-NetTCPConnection 腳本之標記行 WSEMI-PORTPIDS-BEGIN/R <本地埠> <遠端位址> <遠端埠> <PID>/WSEMI-PORTPIDS-END);
//   wsemi 改變其內部格式時, 使用本夾具之案例會失敗(不會靜默通過), 另有真實監聽之案例不依賴此格式


//row, 組 netstat -ano 之一列(欄寬同 Windows), state 為 null 時不輸出狀態欄(狀態值錯誤時之缺欄形)
export function row(proto, local, remote, state, pid) {
    return `  ${proto.padEnd(7)}${local.padEnd(23)}${remote.padEnd(23)}${state === null ? '' : state.padEnd(16)}${pid}`
}


//ns, 組 netstat -ano 之輸出
export function ns(rows) {
    let head = ['', 'Active Connections', '', '  Proto  Local Address          Foreign Address        State           PID']
    return [...head, ...rows].join('\r\n') + '\r\n'
}


//BG, 他埠之背景列, 使輸出形同真實
export let BG = [
    row('TCP', '0.0.0.0:135', '0.0.0.0:0', 'LISTENING', '1356'),
    row('TCP', '0.0.0.0:445', '0.0.0.0:0', 'LISTENING', '4'),
    row('TCP', '192.168.1.10:51234', '140.82.112.3:443', 'ESTABLISHED', '7000'),
    row('TCP', '[::]:135', '[::]:0', 'LISTENING', '1356'),
    row('UDP', '0.0.0.0:5353', '*:*', null, '3100'),
]


//ps, 組 Get-NetTCPConnection 腳本之輸出; rows 為 [本地埠, 遠端位址, 遠端埠, PID]
export function ps(rows) {
    return ['WSEMI-PORTPIDS-BEGIN', ...rows.map((r) => `R ${r.join(' ')}`), 'WSEMI-PORTPIDS-END'].join('\r\n') + '\r\n'
}


//ok, err, 與 spawnSync 同形之結果
export function ok(stdout, status = 0) {
    return { status, stdout, error: null }
}
export function err(code) {
    let e = new Error(`spawn x ${code}`)
    e.code = code
    return { status: null, stdout: '', error: e }
}


//fakeExec, 注入之執行函數: outs 為 { netstat, powershell } 之結果, calls 記錄各次呼叫之 src; 未預期之 src 拋錯(使案例失敗而非靜默通過)
export function fakeExec(outs, calls = []) {
    return (prog, args, o) => {
        calls.push(o.src)
        let r = outs[o.src]
        if (r === undefined) {
            throw new Error(`unexpected src ${o.src}`)
        }
        return r
    }
}
