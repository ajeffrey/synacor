import chalk = require('chalk');
import fs = require('fs');
import assert = require('assert');
import readline = require('readline');

const debug = !!process.env.DEBUG;
let printing = false;
let executing = true;
let playing = !debug;
const breaks = [];
const print = (...args: any[]) => printing && console.log(...args);

const TOTAL_REGISTERS = 8;
const VAL_LIMIT = 32768;
const MAX_VAL = 32775;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

const outfile = fs.openSync('out.txt', 'w+');

let buffer = [];

if(!process.stdin.isTTY) {
  rl.on('line', line => {
    for(let i = 0; i < line.length; i++) {
      buffer.push(line.charCodeAt(i));
    }
    buffer.push('\n'.charCodeAt(0));
  });
}

const fillbuffer = async () => {
  while(buffer.length === 0) {
    await new Promise<void>(resolve => {
      rl.question('', answer => {
        for(let i = 0; i < answer.length; i++) {
          buffer.push(answer.charCodeAt(i));
        }
        buffer.push('\n'.charCodeAt(0));
        resolve();
      });
    });
  }
};

const memory: {[key: number]: number} = {};
const registers: number[] = [];
const stack: number[] = [];
for(let i = 0; i < TOTAL_REGISTERS; i++) {
  registers.push(0);
}

const bin = fs.readFileSync('challenge.bin');
for(let i = 0; i < Math.floor(bin.byteLength / 2); i++) {
  memory[i] = bin.readUInt8(i * 2) | (bin.readUInt8(i * 2 + 1) << 8);
  assert(memory[0] >= 0 && memory[i] <= MAX_VAL);
}

const print_regs = () => {
  print('  ' + chalk.yellow(registers.join(' ')));
}

const lit = (val: number) => {
  return val < VAL_LIMIT ? val : registers[val - VAL_LIMIT];
}

const idval = (val: number) => {
  return val < VAL_LIMIT ? val : `r${val - VAL_LIMIT}`;
}

const mem = (addr: number) => {
  if(addr < VAL_LIMIT) {
    const val = memory[addr];
    print(`mem[${chalk.green(addr)}]: ${chalk.yellow(val)}`);
    return val;
  } else {
    const index = addr - VAL_LIMIT;
    const val = registers[addr - VAL_LIMIT];
    print(`reg[${chalk.green(index)}]: ${chalk.yellow(val)}`);
    return val;
  }
};

const setmem = (addr: number, val: number) => {
  if(addr < VAL_LIMIT) {
    memory[addr] = val;
    print(`  [${chalk.yellow(addr)}: ${chalk.yellow(val)}]`);
   } else {
    registers[addr - VAL_LIMIT] = val;
    print_regs();
   }
};

const allops: {[key: number]: [string, number]} = {
  0: ['halt', 0],
  1: ['set', 2],
  2: ['push', 1],
  3: ['pop', 1],
  4: ['eq', 3],
  5: ['gt', 3],
  6: ['jmp', 1],
  7: ['jt', 2],
  8: ['jf', 2],
  9: ['add', 3],
  10: ['mult', 3],
  11: ['mod', 3],
  12: ['and', 3],
  13: ['or', 3],
  14: ['not', 2],
  15: ['rmem', 2],
  16: ['wmem', 2],
  17: ['call', 1],
  18: ['ret', 0],
  19: ['out', 1],
  20: ['in', 1],
  21: ['noop', 0],
}

let ops = 0;
let halted = false, ip = 0, nip = 0;

async function run() {
  while(!halted) {
    const opcode = memory[ip];
    if(!(opcode in allops)) {
      console.log('invalid position, stepping back');
      ip -= 1;
      continue;
    }
    const [label, count] = allops[opcode];
    const vals: number[] = [];
    for(let i = 0; i < count; i++) {
      const val = memory[ip + i + 1];
      vals.push(val);
    }

    nip = ip + 1 + count;

    if(printing) {
      print(`[${chalk.green(ip)}]: ${label} ${vals.map(idval).join(' ')}`);
    }

    if(!playing || breaks.includes(ip)) {
      playing = false;
      let paused = true;
      while(paused) {
        process.stdout.write('>');
        await fillbuffer();
        let answer = '', char = 0;
        while(1) {
          char = buffer.shift();
          if(char === '\n'.charCodeAt(0)) {
            break;
          } else {
            answer += String.fromCharCode(char);
          }
        }

        if(!process.stdin.isTTY) {
          process.stdout.write(answer + '\n');
        }

        const [cmd, ...args] = answer.split(' ');
        switch(cmd) {
          case 'dump': {
            const done = new Set();
            const entries = [1531];
            fs.writeFileSync(outfile, `[[${ip}]]\n`);
            while(paused) {
              done.add(ip);
              if(!(memory[ip] in allops)) {
                if(entries.length > 0) {
                  ip = entries.shift();
                  fs.writeFileSync(outfile, `\n[[${ip}]]\n`);
                  continue;
                } else {
                  paused = false;
                  break;
                }
              }
              
              const [label, count] = allops[memory[ip]];
              const vals: number[] = [];
              for(let i = 0; i < count; i++) {
                const val = memory[ip + i + 1];
                vals.push(val);
              }

              nip = ip + 1 + count;

              fs.writeFileSync(outfile, `[${ip}]: ${label} ${vals.map(idval).join(' ')}\n`);

              if(label === 'jmp' || label === 'call') {
                const dest = lit(vals[0]);
                if(!done.has(dest)) {
                  entries.push(dest);
                }
              } else if(label === 'jt' || label === 'jf') {
                const dest = lit(vals[1]);
                if(!done.has(dest)) {
                  entries.push(dest);
                }
              }

              if(label === 'ret') {
                if(entries.length > 0) {
                  ip = entries.shift();
                  fs.writeFileSync(outfile, `\n[[${ip}]]\n`);
                  continue;
                } else {
                  paused = false;
                  break;
                }
              }

              ip = nip;
            }
            break;
          };
          case 'st': console.log(chalk.yellow(stack.join(' '))); break;
          case 'sr': registers[parseInt(args[0], 10)] = parseInt(args[1], 10); break;
          case 'rmem': console.log(mem(parseInt(args[0], 10))); break;
          case 'smem': setmem(parseInt(args[0], 10), parseInt(args[1], 10)); break;
          case '.': paused = false; break;
          case 'reg': console.log(chalk.yellow(registers.join(' '))); break;
          case 's': console.log({ playing, executing, breaks, printing }); break;
          case 'play': playing = true; paused = false; break;
          case 'ip': console.log(ip); break;
          case 'p': console.log(`${label} ${vals.join(' ')}`); break;
          case 'exe': executing = !!parseInt(args[0], 2); break;
          case 'go': nip = parseInt(args[0], 10); paused = false; break;
          case 'pr': printing = !!parseInt(args[0], 2); break;
          case 'bp': breaks.push(...args.map(n => parseInt(n, 10))); break;
          case 'pbp': console.log(breaks.join(', ')); break;
          case 'seek': {
            const target = args.map(n => parseInt(n, 10));
            let sip = ip;
            while(sip in memory) {
              if(target.every((f, i) => f == 255 || memory[sip + i] == f)) {
                console.log('found at ' + sip);
              }

              sip += 1;
            }
            break;
          };
        }
      }
    }

    if(executing) {
      await execute(label, vals);
    }

    ip = nip;
    ops += 1;
  }
}
run().then(() => {
  console.log(ops + ' operations completed');
});

async function execute(label, vals) {
  let [a, b, c] = vals;
  switch(label) {
    case 'halt':
      halted = true;
      break;
    case 'set': {
      setmem(a, lit(b));
      break;
    };
    case 'push': {
      stack.push(lit(a));
      print(stack.join(','));
      break;
    };
    case 'pop': {
      const val = stack.pop();
      if(typeof val === 'number') {
        setmem(a, val);
      } else {
        throw new Error('tried to pop empty stack');
      }
      break;
    };
    case 'eq': {
      setmem(a, lit(b) == lit(c) ? 1 : 0);
      break;
    };
    case 'gt': {
      setmem(a, lit(b) > lit(c) ? 1 : 0);
      break;
    };
    case 'jmp': {
      nip = lit(a);
      break;
    };
    case 'jt': {
      const val = lit(a);
      if(val) {
        print('--' + val, 'true, jump', b + '--');
        nip = lit(b);
      } else {
        print('--' + val, 'false, no jump--');
      }
      break;
    };
    case 'jf': {
      const val = lit(a);
      if(!val) {
        print('--' + val, 'false, jump', b + '--');
        nip = lit(b);
      } else {
        print('--' + val, 'true, no jump--');
      }
      break;
    };
    case 'add': {
      setmem(a, (lit(b) + lit(c)) % VAL_LIMIT);
      break;
    };
    case 'mult': {
      setmem(a, (lit(b) * lit(c)) % VAL_LIMIT);
      break;
    };
    case 'mod': {
      setmem(a, lit(b) % lit(c));
      break;
    };
    case 'and': setmem(a, lit(b) & lit(c)); break;
    case 'or':  setmem(a, lit(b) | lit(c)); break;
    case 'not': setmem(a, lit(b) ^ 0b111111111111111); break;
    case 'rmem': setmem(a, mem(lit(b))); break;
    case 'wmem': setmem(lit(a), lit(b)); break;
    case 'call': 
      stack.push(nip);
      nip = lit(a);
      break;
    case 'ret': {
      a = stack.pop();
      if(typeof a === 'number') {
        nip = a;
      } else {
        halted = true;
      }
      break;
    };
    case 'out': {
      process.stdout.write(String.fromCharCode(lit(a)));
      break;
    };
    case 'in': {
      await fillbuffer();
      const val = buffer.shift();
      setmem(a, val);
      break;
    };
    case 'noop': {
      break;
    };
  }
}